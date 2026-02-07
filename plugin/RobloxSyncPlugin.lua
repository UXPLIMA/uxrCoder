--[[
    uxrCoder Plugin
    ================================================================================

    Real-time two-way synchronization between Roblox Studio and VS Code/Antigravity.

    This plugin communicates with a local Node.js server via HttpService to enable
    seamless development workflow between Roblox Studio and external editors.

    Features:
        - Automatic DataModel synchronization
        - Script source code sync
        - Property change detection
        - Instance creation/deletion handling

    Configuration:
        Modify the CONFIG table below to customize behavior.

    Author: UXPLIMA
    License: MIT
    Version: 1.0.0
]]

-- =============================================================================
-- Services
-- =============================================================================

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local Selection = game:GetService("Selection")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

-- =============================================================================
-- Configuration
-- =============================================================================

--- Plugin configuration options.
--- @table CONFIG
--- @field SERVER_URL string URL of the sync server
--- @field SYNC_INTERVAL number Sync interval in seconds
--- @field ENABLED boolean Whether sync is enabled
--- @field DEBUG boolean Enable debug logging
local CONFIG = {
    SERVER_URL = "http://localhost:34872",
    SYNC_INTERVAL = 0.5,  -- 500ms sync interval
    ENABLED = true,
    DEBUG = true  -- Enable temporarily for debugging
}

--- Services to synchronize with the external editor.
local SYNCABLE_SERVICES = {
    "Workspace",
    "Lighting",
    "ReplicatedFirst",
    "ReplicatedStorage",
    "ServerScriptService",
    "ServerStorage",
    "StarterGui",
    "StarterPack",
    "StarterPlayer",
    "Teams",
    "SoundService",
    "LogService"
}

-- =============================================================================
-- Log Streaming Setup
-- =============================================================================

local LogService = game:GetService("LogService")

--- Send a log message to the server
--- @param message string The log message
--- @param type Enum.MessageType The type of log message
local function streamLog(message, type)
    if not isConnected then return end
    
    local level = "info"
    if type == Enum.MessageType.MessageOutput then
        level = "info"
    elseif type == Enum.MessageType.MessageWarning then
        level = "warning"
    elseif type == Enum.MessageType.MessageError then
        level = "error"
    end
    
    -- Filter out our own sync logs to prevent loops
    if string.find(message, "[uxrCoder]") then return end

    spawn(function()
        request("POST", "/sync/delta", {
            changes = {
                {
                    type = "log",
                    level = level,
                    message = message,
                    timestamp = os.time(),
                    source = "Roblox"
                }
            }
        })
    end)
end

LogService.MessageOut:Connect(streamLog)

-- =============================================================================
-- Plugin UI Setup
-- =============================================================================

local toolbar = plugin:CreateToolbar("uxrCoder")

local toggleButton = toolbar:CreateButton(
    "Toggle Sync",
    "Enable/Disable synchronization with external editor",
    "rbxassetid://4458901886"
)
toggleButton:SetActive(CONFIG.ENABLED)

local statusButton = toolbar:CreateButton(
    "Status",
    "Show connection status and statistics",
    "rbxassetid://4458901886"
)

-- =============================================================================
-- State Management
-- =============================================================================

local isConnected = false
local lastSyncTime = 0
local syncCount = 0
local errorCount = 0
local isSyncing = false  -- Prevent concurrent sync operations

-- Change tracking
local trackedConnections = {} -- [Instance] = {Connection, ...}
local pendingChanges = {} -- Array of changes
local pendingChangesMap = {} -- [PathString] = true (for deduplication)
local isInitialSyncComplete = false

-- =============================================================================
-- Utility Functions
-- =============================================================================

--- Log a message to the output (if debug mode is enabled).
--- @param ... any Arguments to log
local function log(...)
    if CONFIG.DEBUG then
        print("[uxrCoder]", ...)
    end
end

--- Log an error to the output.
--- @param ... any Arguments to log
local function logError(...)
    warn("[uxrCoder ERROR]", ...)
end

--- Throttled error logging to prevent spam
local lastErrorTime = 0
local ERROR_THROTTLE = 5 -- Seconds

local function logErrorThrottled(...)
    if os.clock() - lastErrorTime > ERROR_THROTTLE then
        logError(...)
        lastErrorTime = os.clock()
    end
end

--- Make an HTTP request to the sync server with retry logic.
--- @param method string HTTP method (GET, POST, etc.)
--- @param endpoint string API endpoint path
--- @param body table|nil Optional request body
--- @return boolean success Whether the request succeeded
--- @return table|string result Response data or error message
local function request(method, endpoint, body)
    local retries = 0
    local maxRetries = 3
    local lastError = ""

    while retries <= maxRetries do
        if CONFIG.DEBUG then
            warn("[uxrCoder DEBUG] Request:", method, endpoint, "(attempt", retries + 1, ")")
        end
        
        local success, result = pcall(function()
            local response = HttpService:RequestAsync({
                Url = CONFIG.SERVER_URL .. endpoint,
                Method = method,
                Headers = {
                    ["Content-Type"] = "application/json"
                },
                Body = body and HttpService:JSONEncode(body) or nil
            })
            return response
        end)

        if success and result.Success then
            -- Reset error count on success
            errorCount = 0
            if CONFIG.DEBUG then
                warn("[uxrCoder DEBUG] Request SUCCESS:", endpoint)
            end
            return true, HttpService:JSONDecode(result.Body)
        else
            retries = retries + 1
            lastError = result
            
            if CONFIG.DEBUG then
                warn("[uxrCoder DEBUG] Request FAILED:", endpoint, "Error:", tostring(result))
            end
            
            -- Only verify connection failure (don't retry 400/500 errors from server logic)
            if success and not result.Success then
                -- Server responded with error status, don't retry network loop
                return false, result
            end
            
            -- Network error, wait before retry
            if retries <= maxRetries then
                task.wait(0.5 * math.pow(2, retries - 1))
            end
        end
    end
    
    return false, lastError
end

-- =============================================================================
-- Serialization
-- =============================================================================

--- Serialize a Vector3 to a table.
--- @param v Vector3 The vector to serialize
--- @return table Serialized vector
local function serializeVector3(v)
    return {
        type = "Vector3",
        x = v.X,
        y = v.Y,
        z = v.Z
    }
end

--- Serialize a Color3 to a table.
--- @param c Color3 The color to serialize
--- @return table Serialized color
local function serializeColor3(c)
    return {
        type = "Color3",
        r = c.R,
        g = c.G,
        b = c.B
    }
end

--- Serialize a UDim2 to a table.
--- @param u UDim2 The UDim2 to serialize
--- @return table Serialized UDim2
local function serializeUDim2(u)
    return {
        type = "UDim2",
        x = { type = "UDim", scale = u.X.Scale, offset = u.X.Offset },
        y = { type = "UDim", scale = u.Y.Scale, offset = u.Y.Offset }
    }
end

--- Serialize a Vector2 to a table.
local function serializeVector2(v)
    return {
        type = "Vector2",
        x = v.X,
        y = v.Y
    }
end

--- Serialize a CFrame to a table.
local function serializeCFrame(cf)
    local pos = cf.Position
    local x, y, z = cf:ToEulerAnglesXYZ()
    return {
        type = "CFrame",
        position = { type = "Vector3", x = pos.X, y = pos.Y, z = pos.Z },
        orientation = { type = "Vector3", x = math.deg(x), y = math.deg(y), z = math.deg(z) }
    }
end

--- Serialize a UDim to a table.
local function serializeUDim(u)
    return {
        type = "UDim",
        scale = u.Scale,
        offset = u.Offset
    }
end

--- Serialize a BrickColor to a table.
local function serializeBrickColor(bc)
    return {
        type = "BrickColor",
        number = bc.Number,
        name = bc.Name
    }
end

--- Serialize a NumberRange to a table.
local function serializeNumberRange(nr)
    return {
        type = "NumberRange",
        min = nr.Min,
        max = nr.Max
    }
end

--- Serialize a Rect to a table.
local function serializeRect(r)
    return {
        type = "Rect",
        min = { type = "Vector2", x = r.Min.X, y = r.Min.Y },
        max = { type = "Vector2", x = r.Max.X, y = r.Max.Y }
    }
end

--- Serialize an EnumItem to a table.
local function serializeEnum(e)
    return {
        type = "Enum",
        enumType = tostring(e.EnumType),
        value = e.Value,
        name = e.Name
    }
end

--- Serialize a Roblox Instance to a table.
--- @param instance Instance The instance to serialize
--- @return table Serialized instance data
local function serializeInstance(instance)
    local properties = {}

    -- Always include Name
    properties.Name = instance.Name

    -- Serialize script source
    if instance:IsA("LuaSourceContainer") then
        local success, source = pcall(function()
            return instance.Source
        end)
        if success then
            properties.Source = source
        end
    end

    -- Serialize BasePart properties
    if instance:IsA("BasePart") then
        properties.Position = serializeVector3(instance.Position)
        properties.Size = serializeVector3(instance.Size)
        properties.Color = serializeColor3(instance.Color)
        properties.Anchored = instance.Anchored
        properties.CanCollide = instance.CanCollide
        properties.Transparency = instance.Transparency
        properties.Material = instance.Material.Name
    end

    -- Serialize Model properties
    if instance:IsA("Model") then
        if instance.PrimaryPart then
            properties.PrimaryPart = instance.PrimaryPart:GetFullName()
        end
    end

    -- Serialize GuiObject properties
    if instance:IsA("GuiObject") then
        properties.Position = serializeUDim2(instance.Position)
        properties.Size = serializeUDim2(instance.Size)
        properties.Visible = instance.Visible
        properties.BackgroundTransparency = instance.BackgroundTransparency

        -- Text properties
        if instance:IsA("TextLabel") or instance:IsA("TextButton") or instance:IsA("TextBox") then
            properties.Text = instance.Text
            properties.TextColor3 = serializeColor3(instance.TextColor3)
            properties.TextSize = instance.TextSize
        end
    end

    -- Serialize children recursively
    local children = {}
    for _, child in ipairs(instance:GetChildren()) do
        -- Skip certain instances that shouldn't sync
        if not child:IsA("Camera") or child.Name ~= "CurrentCamera" then
            table.insert(children, serializeInstance(child))
        end
    end

    return {
        id = tostring(instance:GetDebugId()),
        className = instance.ClassName,
        name = instance.Name,
        parent = instance.Parent and instance.Parent:GetFullName() or nil,
        properties = properties,
        children = children
    }
end

--- Serialize all syncable services to a table.
--- @return table Array of serialized service instances
local function serializeDataModel()
    local instances = {}

    for _, serviceName in ipairs(SYNCABLE_SERVICES) do
        local success, service = pcall(function()
            return game:GetService(serviceName)
        end)

        if success and service then
            table.insert(instances, serializeInstance(service))
        else
            log("Could not access service:", serviceName)
        end
    end

    return instances
end

-- =============================================================================
-- Change Application
-- =============================================================================

--- Deserialize a value from a table to a Roblox type.
--- @param val any The value to deserialize
--- @return any The deserialized value
local function deserializeValue(val)
    if type(val) ~= "table" then
        return val
    end

    if val.type == "Vector3" then
        return Vector3.new(val.x, val.y, val.z)
    elseif val.type == "Vector2" then
        return Vector2.new(val.x, val.y)
    elseif val.type == "CFrame" then
        local pos = Vector3.new(val.position.x, val.position.y, val.position.z)
        local orient = Vector3.new(val.orientation.x, val.orientation.y, val.orientation.z)
        return CFrame.new(pos) * CFrame.fromEulerAnglesXYZ(math.rad(orient.x), math.rad(orient.y), math.rad(orient.z))
    elseif val.type == "Color3" then
        return Color3.new(val.r, val.g, val.b)
    elseif val.type == "UDim2" then
        return UDim2.new(
            UDim.new(val.x.scale, val.x.offset),
            UDim.new(val.y.scale, val.y.offset)
        )
    elseif val.type == "UDim" then
        return UDim.new(val.scale, val.offset)
    elseif val.type == "BrickColor" then
        return BrickColor.new(val.name)
    elseif val.type == "NumberRange" then
        return NumberRange.new(val.min, val.max)
    elseif val.type == "Rect" then
        return Rect.new(val.min.x, val.min.y, val.max.x, val.max.y)
    elseif val.type == "Enum" then
        -- Enum deserialization might need to look up the enum
        -- val.enumType (string), val.name (string)
        -- e.g. Enum.Material.Plastic
        local enumType = Enum[val.enumType]
        if enumType then
            return enumType[val.name]
        end
        return nil
    end

    return val
end

--- Apply a change received from the external editor.
--- @param change table The change to apply
local function applyChange(change)
    ChangeHistoryService:SetWaypoint("uxrCoder: Before change")

    local path = change.path
    local target = game
    
    -- For create operations, we need to navigate to the PARENT, not the full path
    local pathToNavigate = path
    if change.type == "create" then
        pathToNavigate = {}
        for i = 1, #path - 1 do
            table.insert(pathToNavigate, path[i])
        end
    end

    -- Navigate to the target instance
    for i, name in ipairs(pathToNavigate) do
        if i == 1 then
            -- First element is a service name
            local success, service = pcall(function()
                return game:GetService(name)
            end)
            if success then
                target = service
            else
                target = game:FindFirstChild(name)
            end
        else
            target = target and target:FindFirstChild(name)
        end

        if not target then
            logError("Could not find instance:", table.concat(pathToNavigate, "."))
            return
        end
    end

    -- Apply the change based on type
    if change.type == "create" and change.instance then
        local parent = target
        if parent then
            local success, err = pcall(function()
                local newInstance = Instance.new(change.instance.className)
                newInstance.Name = change.instance.name

                -- Apply properties
                if change.instance.properties then
                    for propName, propValue in pairs(change.instance.properties) do
                        local deserializedValue = deserializeValue(propValue)
                        if propName == "Source" and newInstance:IsA("LuaSourceContainer") then
                            newInstance.Source = deserializedValue
                        else
                             -- Try to set property if it exists
                             pcall(function() newInstance[propName] = deserializedValue end)
                        end
                    end
                end

                newInstance.Parent = parent
                warn("[uxrCoder] Instance created successfully:", newInstance:GetFullName())
            end)

            if not success then
                logError("Failed to create instance:", err)
            end
        end

    elseif change.type == "update" and target and change.property then
        local success, err = pcall(function()
            local propName = change.property.name
            local propValue = deserializeValue(change.property.value)

            if propName == "Source" and target:IsA("LuaSourceContainer") then
                target.Source = propValue
                log("Updated source:", target:GetFullName())
            else
                -- Generic property update
                target[propName] = propValue
                log("Updated " .. propName .. ":", target:GetFullName())
            end
        end)

        if not success then
            logError("Failed to update property:", err)
        end

    elseif change.type == "delete" and target then
        local fullName = target:GetFullName()
        local success, err = pcall(function()
            target:Destroy()
        end)

        if success then
            log("Deleted:", fullName)
        else
            logError("Failed to delete:", err)
        end
    elseif change.type == "command" then
        if change.action == "play" then
             log("Command 'play' received - Starting Play Solo is restricted in plugins")
        elseif change.action == "stop" then
             log("Command 'stop' received")
        elseif change.action == "run" then
             log("Command 'run' received")
             RunService:Run()
        end
    end

    ChangeHistoryService:SetWaypoint("uxrCoder: Transaction committed")
end

-- =============================================================================
-- Sync Loop
-- =============================================================================

--- Perform a sync cycle with the server.
-- =============================================================================
-- Change Tracking & Batching
-- =============================================================================

--- Queue a change to be sent to the server.
--- @param changeType string "create" | "update" | "delete"
--- @param instance Instance The instance involved
--- @param property string|nil The property name (for updates)
local function queueChange(changeType, instance, property)
    if not isInitialSyncComplete then return end
    
    -- Generate path
    local path = {}
    local current = instance
    while current and current ~= game do
        table.insert(path, 1, current.Name)
        current = current.Parent
    end
    
    -- If path is empty or root (game), ignore
    if #path == 0 then return end
    
    local change = {
        type = changeType,
        timestamp = os.time(),
        path = path
    }
    
    if changeType == "create" then
        change.instance = serializeInstance(instance)
    elseif changeType == "update" then
        if not property then return end
        change.property = {
            name = property,
            value = instance[property]
        }
        -- Handle special types
        local val = change.property.value
        local t = typeof(val)
        
        if t == "Vector3" then
            change.property.value = serializeVector3(val)
        elseif t == "Vector2" then
            change.property.value = serializeVector2(val)
        elseif t == "CFrame" then
            change.property.value = serializeCFrame(val)
        elseif t == "Color3" then
            change.property.value = serializeColor3(val)
        elseif t == "UDim2" then
            change.property.value = serializeUDim2(val)
        elseif t == "UDim" then
            change.property.value = serializeUDim(val)
        elseif t == "BrickColor" then
            change.property.value = serializeBrickColor(val)
        elseif t == "NumberRange" then
            change.property.value = serializeNumberRange(val)
        elseif t == "Rect" then
            change.property.value = serializeRect(val)
        elseif t == "EnumItem" then
            change.property.value = serializeEnum(val)
        end
    elseif changeType == "delete" then
        -- Path is enough for delete
    end

    -- Simple deduplication key
    local key = changeType .. ":" .. table.concat(path, ".") .. (property or "")
    
    if not pendingChangesMap[key] then
        table.insert(pendingChanges, change)
        pendingChangesMap[key] = true
    end
end

--- Track an instance's changes.
--- @param instance Instance The instance to track
local function trackInstance(instance)
    if trackedConnections[instance] then return end
    
    local connections = {}
    
    -- Track property changes
    table.insert(connections, instance.Changed:Connect(function(property)
        -- Filter relevant properties (Expanded list)
        if property == "Name" or property == "Source" or 
           property == "Position" or property == "Size" or property == "CFrame" or
           property == "Color" or property == "BrickColor" or
           property == "Anchored" or property == "CanCollide" or property == "Transparency" or
           property == "Reflectance" or property == "Material" or
           property == "Text" or property == "TextColor3" or property == "TextSize" or 
           property == "BackgroundTransparency" or property == "BackgroundColor3" or
           property == "Visible" or property == "ZIndex" or property == "LayoutOrder" or
           property == "Image" or property == "ImageColor3" or property == "ImageTransparency" then
            queueChange("update", instance, property)
        end
    end))
    
    trackedConnections[instance] = connections
end

--- Stop tracking an instance.
--- @param instance Instance The instance to untrack
local function untrackInstance(instance)
    if trackedConnections[instance] then
        for _, conn in ipairs(trackedConnections[instance]) do
            conn:Disconnect()
        end
        trackedConnections[instance] = nil
    end
end

--- Setup tracking for a service and its descendants.
--- @param service Instance
local function trackService(service)
    -- Track existing descendants
    for _, descendant in ipairs(service:GetDescendants()) do
        trackInstance(descendant)
    end
    trackInstance(service)
    
    -- Listen for new descendants
    service.DescendantAdded:Connect(function(descendant)
        trackInstance(descendant)
        queueChange("create", descendant)
    end)
    
    -- Listen for removed descendants
    service.DescendantRemoving:Connect(function(descendant)
        untrackInstance(descendant)
        queueChange("delete", descendant)
    end)
end

-- =============================================================================
-- Sync Loop
-- =============================================================================

--- Perform a sync cycle with the server.
local function syncWithServer()
    if not CONFIG.ENABLED then
        return
    end
    
    -- Prevent concurrent sync operations
    if isSyncing then
        return
    end
    isSyncing = true
    
    local function finishSync()
        isSyncing = false
        lastSyncTime = os.clock()
    end

    -- Initial Sync Logic - send full DataModel if not yet synced
    if not isInitialSyncComplete then
        -- Try to connect/handshake with full DataModel
        warn("[uxrCoder] Performing initial sync...")
        local success, response = request("POST", "/sync", { 
            instances = serializeDataModel(),
            isInitial = true 
        })

        if success then
            warn("[uxrCoder] [OK] Initial synchronization established.")
            isInitialSyncComplete = true
            syncCount = syncCount + 1
            
            -- Setup tracking
            for _, serviceName in ipairs(SYNCABLE_SERVICES) do
                local service = game:GetService(serviceName)
                if service then
                    trackService(service)
                end
            end
            
            isConnected = true
            lastSyncTime = os.clock()
            statusButton.Icon = "rbxassetid://4458901886"
        else
             -- Connection failed
             isConnected = false
             warn("[uxrCoder] Initial sync failed, will retry...")
             finishSync()
             return
        end
    else
        -- Regular Sync - Check server health/state first
        -- If server theoretically has 0 instances but we are synced, it means server restarted.
        local healthSuccess, healthResponse = request("GET", "/health")
        if healthSuccess and healthResponse.instanceCount == 0 then
            warn("[uxrCoder] [WARNING] Server state loss detected (restart). Re-initiating synchronization...")
            isInitialSyncComplete = false
            finishSync()
            return -- Next loop will handle initial sync
        end
    end

    -- Delta Sync Logic: Send pending changes
    if #pendingChanges > 0 then
        local batch = pendingChanges
        -- Clear queue
        pendingChanges = {}
        pendingChangesMap = {}
        
        local success, response = request("POST", "/sync/delta", { changes = batch })
        
        if success then
            log("Synced", #batch, "changes")
            errorCount = 0
        else
            -- Put changes back in queue? Or just rely on full resync logic?
            -- For now, simple retry next loop (but we cleared them... dangerous)
            -- Ideally, we only clear on success.
            -- TODO: Implement robust queue restoration on failure.
            logErrorThrottled("Failed to sync delta changes")
        end
    end

    -- Check for pending changes from editor (keep existing polling for now)
    if isConnected then
        local changeSuccess, changeResponse = request("GET", "/changes")

        if changeSuccess and changeResponse.changes then
            local appliedIds = {}

            for _, change in ipairs(changeResponse.changes) do
                applyChange(change)
                table.insert(appliedIds, change.id)
            end

            -- Confirm changes were applied
            if #appliedIds > 0 then
                request("POST", "/changes/confirm", { ids = appliedIds })
                log("Applied", #appliedIds, "changes from editor")
            end
        end
    end
    
    finishSync()
end


-- =============================================================================
-- Event Handlers
-- =============================================================================

--- Handle toggle button click.
toggleButton.Click:Connect(function()
    CONFIG.ENABLED = not CONFIG.ENABLED
    toggleButton:SetActive(CONFIG.ENABLED)

    if CONFIG.ENABLED then
        warn("[uxrCoder] Sync ENABLED")
    else
        warn("[uxrCoder] Sync DISABLED")
    end
end)

statusButton.Click:Connect(function()
    local status = isConnected and "[CONNECTED]" or "[DISCONNECTED]"
    local uptime = os.clock() - lastSyncTime

    local message = string.format([[
uxrCoder Status
═══════════════════════════════════
%s

Server: %s
Last Sync: %.1fs ago
Total Syncs: %d
Errors: %d
═══════════════════════════════════
    ]], status, CONFIG.SERVER_URL, uptime, syncCount, errorCount)

    warn(message)
end)

-- =============================================================================
-- Main Loop
-- =============================================================================

local syncConnection
syncConnection = RunService.Heartbeat:Connect(function()
    if os.clock() - lastSyncTime >= CONFIG.SYNC_INTERVAL then
        task.spawn(syncWithServer)
    end
end)

-- =============================================================================
-- Initialization
-- =============================================================================

-- Perform initial connection test
    local success, response = request("GET", "/health")

    if success then
        log("[OK] Communication with uxrCoder server verified.")
        log("   Environment Version:", response.version or "unknown")
        isConnected = true
        statusButton.Icon = "rbxassetid://4458901886" -- Valid icon
    else
        logError("Server not running. Start the server and click Toggle Sync.")
        logError("Expected server at:", CONFIG.SERVER_URL)
        -- Could set a 'disconnected' icon here
    end
end)

-- Cleanup on plugin unload
plugin.Unloading:Connect(function()
    if syncConnection then
        syncConnection:Disconnect()
    end
    log("Plugin unloaded")
end)

-- Startup message
print([[
╔═══════════════════════════════════════════════════════════╗
║   uxrCoder Plugin v1.0.0                             ║
║   Real-time sync with VS Code/Antigravity                ║
║                                                           ║
║   Use the toolbar buttons to control sync                ║
╚═══════════════════════════════════════════════════════════╝
]])
