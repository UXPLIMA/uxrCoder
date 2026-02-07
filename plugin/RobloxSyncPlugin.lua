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
    SYNC_INTERVAL = 0.1,  -- 100ms for responsive sync
    ENABLED = true,
    DEBUG = false
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
    "SoundService"
}

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

--- Make an HTTP request to the sync server.
--- @param method string HTTP method (GET, POST, etc.)
--- @param endpoint string API endpoint path
--- @param body table|nil Optional request body
--- @return boolean success Whether the request succeeded
--- @return table|string result Response data or error message
local function request(method, endpoint, body)
    local success, result = pcall(function()
        local response = HttpService:RequestAsync({
            Url = CONFIG.SERVER_URL .. endpoint,
            Method = method,
            Headers = {
                ["Content-Type"] = "application/json",
                ["User-Agent"] = "uxrCoder/1.0.0"
            },
            Body = body and HttpService:JSONEncode(body) or nil
        })
        return response
    end)

    if success and result.Success then
        return true, HttpService:JSONDecode(result.Body)
    else
        return false, result
    end
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
        xScale = u.X.Scale,
        xOffset = u.X.Offset,
        yScale = u.Y.Scale,
        yOffset = u.Y.Offset
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

--- Apply a change received from the external editor.
--- @param change table The change to apply
local function applyChange(change)
    ChangeHistoryService:SetWaypoint("uxrCoder: Before change")

    local path = change.path
    local target = game

    -- Navigate to the target instance
    for i, name in ipairs(path) do
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
            logError("Could not find instance:", table.concat(path, "."))
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
                        if propName == "Source" and newInstance:IsA("LuaSourceContainer") then
                            newInstance.Source = propValue
                        end
                    end
                end

                newInstance.Parent = parent
                log("Created:", newInstance:GetFullName())
            end)

            if not success then
                logError("Failed to create instance:", err)
            end
        end

    elseif change.type == "update" and target and change.property then
        local success, err = pcall(function()
            local propName = change.property.name
            local propValue = change.property.value

            if propName == "Source" and target:IsA("LuaSourceContainer") then
                target.Source = propValue
                log("Updated source:", target:GetFullName())
            elseif propName == "Name" then
                target.Name = propValue
                log("Renamed:", target:GetFullName())
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
    end

    ChangeHistoryService:SetWaypoint("uxrCoder: After change")
end

-- =============================================================================
-- Sync Loop
-- =============================================================================

--- Perform a sync cycle with the server.
local function syncWithServer()
    if not CONFIG.ENABLED then
        return
    end

    -- Send current DataModel state
    local instances = serializeDataModel()
    local success, response = request("POST", "/sync", { instances = instances })

    if success then
        isConnected = true
        lastSyncTime = os.clock()
        syncCount = syncCount + 1

        if response.changesApplied and response.changesApplied > 0 then
            log("Synced successfully, changes applied:", response.changesApplied)
        end
    else
        if isConnected then
            logError("Connection lost")
        end
        isConnected = false
        errorCount = errorCount + 1
    end

    -- Check for pending changes from editor
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
end

-- =============================================================================
-- Event Handlers
-- =============================================================================

--- Handle toggle button click.
toggleButton.Click:Connect(function()
    CONFIG.ENABLED = not CONFIG.ENABLED
    toggleButton:SetActive(CONFIG.ENABLED)

    if CONFIG.ENABLED then
        log("Sync enabled")
    else
        log("Sync disabled")
    end
end)

--- Handle status button click.
statusButton.Click:Connect(function()
    local status = isConnected and "🟢 Connected" or "🔴 Disconnected"
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
task.spawn(function()
    local success, response = request("GET", "/health")

    if success then
        log("✅ Connected to uxrCoder server!")
        log("   Version:", response.version or "unknown")
        isConnected = true
    else
        logError("Server not running. Start the server and click Toggle Sync.")
        logError("Expected server at:", CONFIG.SERVER_URL)
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
