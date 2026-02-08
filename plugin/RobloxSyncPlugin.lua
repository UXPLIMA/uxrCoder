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
local TestService = game:GetService("TestService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

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
    DEBUG = false  -- Enable temporarily for debugging
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

-- Forward declarations used by early event handlers
local request
local isConnected = false

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

isConnected = false
local lastSyncTime = 0
local syncCount = 0
local errorCount = 0
local isSyncing = false  -- Prevent concurrent sync operations
local isApplyingServerChange = false  -- Suppress echo-back when applying server changes
local isApplyingAgentTestIsolationChange = false  -- Suppress sync during test-step and cleanup mutations

-- Change tracking
local trackedConnections = {} -- [Instance] = {Connection, ...}
local serviceConnections = {} -- [Service] = {Connection, Connection}
local pendingChanges = {} -- Array of changes
local pendingChangesMap = {} -- [Key] = index in pendingChanges (for coalescing)
local isInitialSyncComplete = false
local currentAgentTestRunId = nil
local currentAgentTestAbortRequested = false
local currentAgentTestAttempt = nil

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
request = function(method, endpoint, body)
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

LogService.MessageOut:Connect(streamLog)

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
    local enumTypeName = ""
    local enumValue = nil
    local enumName = nil

    -- Some APIs can surface enum type objects (typeof == "Enum") instead of enum items.
    -- Treat those as enum metadata payloads and avoid accessing item-only members.
    if typeof(e) == "Enum" then
        enumTypeName = tostring(e)
        enumTypeName = string.gsub(enumTypeName, "^Enum%.", "")
        return {
            type = "Enum",
            enumType = enumTypeName,
            value = nil,
            name = nil
        }
    end

    local successEnumType, enumTypeObj = pcall(function()
        return e.EnumType
    end)

    if successEnumType and enumTypeObj then
        enumTypeName = tostring(enumTypeObj)
        enumTypeName = string.gsub(enumTypeName, "^Enum%.", "")
    end

    local successValue, value = pcall(function()
        return e.Value
    end)
    if successValue then
        enumValue = value
    end

    local successName, name = pcall(function()
        return e.Name
    end)
    if successName then
        enumName = name
    end

    return {
        type = "Enum",
        enumType = enumTypeName,
        value = enumValue,
        name = enumName
    }
end

--- Serialize a NumberSequence to a table.
local function serializeNumberSequence(ns)
    local keypoints = {}
    for _, kp in ipairs(ns.Keypoints) do
        table.insert(keypoints, {
            time = kp.Time,
            value = kp.Value,
            envelope = kp.Envelope
        })
    end
    return {
        type = "NumberSequence",
        keypoints = keypoints
    }
end

--- Serialize a ColorSequence to a table.
local function serializeColorSequence(cs)
    local keypoints = {}
    for _, kp in ipairs(cs.Keypoints) do
        table.insert(keypoints, {
            time = kp.Time,
            value = serializeColor3(kp.Value)
        })
    end
    return {
        type = "ColorSequence",
        keypoints = keypoints
    }
end

--- Serialize PhysicalProperties to a table.
local function serializePhysicalProperties(pp)
    return {
        type = "PhysicalProperties",
        density = pp.Density,
        friction = pp.Friction,
        elasticity = pp.Elasticity,
        frictionWeight = pp.FrictionWeight,
        elasticityWeight = pp.ElasticityWeight
    }
end

--- Serialize any property value to a JSON-safe payload.
--- @return boolean success, any serializedValue
local function serializePropertyValue(value, includeUnsupported)
    local valueType = typeof(value)

    if valueType == "boolean" or valueType == "number" or valueType == "string" then
        return true, value
    elseif valueType == "Vector3" then
        return true, serializeVector3(value)
    elseif valueType == "Vector2" then
        return true, serializeVector2(value)
    elseif valueType == "CFrame" then
        return true, serializeCFrame(value)
    elseif valueType == "Color3" then
        return true, serializeColor3(value)
    elseif valueType == "UDim2" then
        return true, serializeUDim2(value)
    elseif valueType == "UDim" then
        return true, serializeUDim(value)
    elseif valueType == "BrickColor" then
        return true, serializeBrickColor(value)
    elseif valueType == "NumberRange" then
        return true, serializeNumberRange(value)
    elseif valueType == "Rect" then
        return true, serializeRect(value)
    elseif valueType == "EnumItem" or valueType == "Enum" then
        return true, serializeEnum(value)
    elseif valueType == "NumberSequence" then
        return true, serializeNumberSequence(value)
    elseif valueType == "ColorSequence" then
        return true, serializeColorSequence(value)
    elseif valueType == "PhysicalProperties" then
        return true, serializePhysicalProperties(value)
    elseif valueType == "Instance" then
        return true, {
            type = "InstanceRef",
            path = value:GetFullName()
        }
    end

    if includeUnsupported then
        -- Keep unsupported values visible in property panel as read-only payload.
        return true, {
            type = "Unsupported",
            robloxType = valueType,
            value = tostring(value)
        }
    end

    return false, nil
end

--- Try reading and serializing one property from an instance.
--- @return boolean success, any serializedValue
local function serializeProperty(instance, propertyName, includeUnsupported)
    local readSuccess, rawValue = pcall(function()
        return instance[propertyName]
    end)
    if not readSuccess then
        return false, nil
    end

    local serializeSuccess, serializedValue = serializePropertyValue(rawValue, includeUnsupported == true)
    if not serializeSuccess then
        return false, nil
    end

    return true, serializedValue
end

-- Property profiles by inheritance roots.
local PROPERTY_PROFILES = {
    Instance = { "Archivable" },
    ValueBase = { "Value" },
    PVInstance = { "PivotOffset" },
    Model = { "PrimaryPart", "WorldPivot", "LevelOfDetail", "ModelStreamingMode" },
    BasePart = {
        "Position", "Orientation", "CFrame", "Size", "Color", "BrickColor",
        "Material", "MaterialVariant", "Transparency", "Reflectance", "Anchored",
        "CanCollide", "CanTouch", "CanQuery", "CastShadow", "Massless", "Locked",
        "CollisionGroup", "Shape", "AssemblyLinearVelocity", "AssemblyAngularVelocity",
        "CustomPhysicalProperties"
    },
    Part = {
        "Shape", "TopSurface", "BottomSurface", "LeftSurface", "RightSurface",
        "FrontSurface", "BackSurface", "TopSurfaceInput", "BottomSurfaceInput",
        "LeftSurfaceInput", "RightSurfaceInput", "FrontSurfaceInput", "BackSurfaceInput"
    },
    MeshPart = { "MeshId", "TextureID", "RenderFidelity", "DoubleSided", "CollisionFidelity" },
    UnionOperation = { "RenderFidelity", "CollisionFidelity", "UsePartColor" },
    SpecialMesh = { "MeshId", "TextureId", "MeshType", "Scale", "Offset", "VertexColor" },
    Decal = { "Texture", "Color3", "Transparency", "Face" },
    Texture = { "Texture", "Color3", "Transparency", "Face", "StudsPerTileU", "StudsPerTileV", "OffsetStudsU", "OffsetStudsV" },
    Light = { "Enabled", "Brightness", "Color", "Shadows" },
    PointLight = { "Range" },
    SpotLight = { "Range", "Angle", "Face" },
    SurfaceLight = { "Range", "Angle", "Face" },
    Attachment = { "Position", "Orientation", "Axis", "SecondaryAxis", "Visible" },
    Beam = {
        "Enabled", "FaceCamera", "LightEmission", "LightInfluence",
        "Texture", "TextureLength", "TextureMode", "TextureSpeed", "Transparency", "Width0", "Width1",
        "Color", "CurveSize0", "CurveSize1", "Segments"
    },
    Trail = {
        "Enabled", "FaceCamera", "Lifetime", "LightEmission", "LightInfluence",
        "Texture", "TextureLength", "TextureMode", "TextureSpeed", "Transparency", "WidthScale", "Color"
    },
    ParticleEmitter = {
        "Enabled", "Color", "LightEmission", "LightInfluence", "Orientation",
        "Size", "Speed", "SpreadAngle", "Texture", "Transparency",
        "Acceleration", "Drag", "EmissionDirection", "Lifetime", "Rate", "RotSpeed", "Rotation",
        "Shape", "ShapeInOut", "ShapeStyle", "Squash", "VelocityInheritance", "ZOffset"
    },
    Sound = {
        "SoundId", "Volume", "PlaybackSpeed", "Looped", "RollOffMode", "RollOffMaxDistance",
        "RollOffMinDistance", "EmitterSize", "PlayOnRemove", "TimePosition", "Pitch", "SoundGroup"
    },
    Camera = { "CFrame", "Focus", "FieldOfView", "CameraType", "CameraSubject" },
    GuiObject = {
        "Position", "Size", "AnchorPoint", "Rotation", "BackgroundColor3", "BackgroundTransparency",
        "BorderColor3", "BorderMode", "BorderSizePixel", "Visible", "ZIndex", "LayoutOrder",
        "AutomaticSize", "ClipsDescendants"
    },
    GuiButton = { "AutoButtonColor", "Modal", "Selected" },
    TextLabel = { "Text", "TextColor3", "TextSize", "TextTransparency", "TextWrapped", "TextScaled", "FontFace", "RichText", "TextXAlignment", "TextYAlignment" },
    TextButton = { "Text", "TextColor3", "TextSize", "TextTransparency", "TextWrapped", "TextScaled", "FontFace", "RichText", "TextXAlignment", "TextYAlignment" },
    TextBox = { "Text", "TextColor3", "TextSize", "TextTransparency", "TextWrapped", "TextScaled", "FontFace", "RichText", "TextXAlignment", "TextYAlignment", "PlaceholderText", "ClearTextOnFocus", "MultiLine" },
    ImageLabel = { "Image", "ImageColor3", "ImageTransparency", "ScaleType", "SliceCenter", "TileSize", "ResampleMode" },
    ImageButton = { "Image", "ImageColor3", "ImageTransparency", "ScaleType", "SliceCenter", "TileSize", "ResampleMode", "HoverImage", "PressedImage" },
    ScreenGui = { "Enabled", "DisplayOrder", "IgnoreGuiInset", "ResetOnSpawn", "ZIndexBehavior" },
    SurfaceGui = { "Adornee", "AlwaysOnTop", "CanvasSize", "ClipsDescendants", "Face", "LightInfluence", "PixelsPerStud", "SizingMode" },
    BillboardGui = {
        "Adornee", "AlwaysOnTop", "Brightness", "CanvasSize", "ClipsDescendants", "ExtentsOffset", "ExtentsOffsetWorldSpace",
        "LightInfluence", "MaxDistance", "Size", "SizeOffset", "StudsOffset", "StudsOffsetWorldSpace"
    },
    ScrollingFrame = { "CanvasPosition", "CanvasSize", "AutomaticCanvasSize", "ScrollBarThickness", "ScrollingDirection" },
    UIStroke = { "ApplyStrokeMode", "Color", "Enabled", "LineJoinMode", "Thickness", "Transparency" },
    UICorner = { "CornerRadius" },
    UIScale = { "Scale" },
    UIAspectRatioConstraint = { "AspectRatio", "AspectType", "DominantAxis" },
    UIListLayout = { "FillDirection", "HorizontalAlignment", "SortOrder", "VerticalAlignment", "Padding" },
    UIGridLayout = {
        "FillDirection", "FillDirectionMaxCells", "HorizontalAlignment", "SortOrder", "VerticalAlignment",
        "CellPadding", "CellSize", "StartCorner"
    },
    Humanoid = { "Health", "MaxHealth", "WalkSpeed", "JumpHeight", "JumpPower", "UseJumpPower", "AutoRotate", "HipHeight" },
    StringValue = { "Value" },
    NumberValue = { "Value" },
    IntValue = { "Value" },
    BoolValue = { "Value" },
    Vector3Value = { "Value" },
    CFrameValue = { "Value" },
    Color3Value = { "Value" },
    ObjectValue = { "Value" },
    Tool = {
        "CanBeDropped", "Enabled", "GripForward", "GripPos", "GripRight", "GripUp",
        "ManualActivationOnly", "RequiresHandle", "TextureId", "ToolTip"
    },
    Animation = { "AnimationId" },
}

local trackedPropertySetCache = {} -- [ClassName] = { [propertyName] = true }
local dynamicPropertySupportCache = {} -- [ClassName] = { [propertyName] = boolean }
local BLOCKED_SYNC_PROPERTIES = {
    Parent = true,
    ClassName = true,
    Children = true,
}
local AUTO_DISCOVERY_CANDIDATES = {
    "Enabled", "Disabled",
    "TopSurface", "BottomSurface", "LeftSurface", "RightSurface", "FrontSurface", "BackSurface",
    "TopSurfaceInput", "BottomSurfaceInput", "LeftSurfaceInput", "RightSurfaceInput", "FrontSurfaceInput", "BackSurfaceInput",
    "Shape", "FormFactor", "MeshId", "TextureID", "TextureId", "MeshType", "Scale", "Offset", "VertexColor",
    "RenderFidelity", "CollisionFidelity", "UsePartColor", "DoubleSided",
    "DisplayOrder", "IgnoreGuiInset", "ResetOnSpawn", "ZIndexBehavior", "SafeAreaCompatibility", "ClipToDeviceSafeArea",
    "CanvasSize", "CanvasPosition", "AutomaticCanvasSize", "ScrollBarThickness", "ScrollingDirection",
    "HorizontalScrollBarInset", "VerticalScrollBarInset",
    "ImageRectOffset", "ImageRectSize", "TextStrokeColor3", "TextStrokeTransparency", "LineHeight", "MaxVisibleGraphemes",
    "Adornee", "AlwaysOnTop", "LightInfluence", "Brightness", "ExtentsOffset", "ExtentsOffsetWorldSpace",
    "PixelsPerStud", "SizingMode", "StudsOffset", "StudsOffsetWorldSpace",
    "CanBeDropped", "RequiresHandle", "GripPos", "GripForward", "GripRight", "GripUp", "ToolTip", "ManualActivationOnly",
    "AnimationId"
}

--- Opportunistically discover additional scriptable/serializable properties for a class.
local function discoverPropertiesForClass(instance, propertySet)
    for _, propertyName in ipairs(AUTO_DISCOVERY_CANDIDATES) do
        if not propertySet[propertyName] and not BLOCKED_SYNC_PROPERTIES[propertyName] then
            local canSerialize = serializeProperty(instance, propertyName, false)
            if canSerialize then
                propertySet[propertyName] = true
            end
        end
    end
end

--- Get merged property set for an instance class.
local function getTrackedPropertySet(instance)
    local className = instance.ClassName
    if trackedPropertySetCache[className] then
        return trackedPropertySetCache[className]
    end

    local propertySet = { Name = true }
    if instance:IsA("LuaSourceContainer") then
        propertySet.Source = true
    end

    for baseClass, properties in pairs(PROPERTY_PROFILES) do
        if instance:IsA(baseClass) then
            for _, propertyName in ipairs(properties) do
                propertySet[propertyName] = true
            end
        end
    end

    discoverPropertiesForClass(instance, propertySet)

    trackedPropertySetCache[className] = propertySet
    dynamicPropertySupportCache[className] = dynamicPropertySupportCache[className] or {}
    return propertySet
end

--- Decide whether a property should be tracked and synced.
local function isPropertySyncable(instance, propertyName)
    if BLOCKED_SYNC_PROPERTIES[propertyName] then
        return false
    end

    local propertySet = getTrackedPropertySet(instance)
    if propertySet[propertyName] then
        return true
    end

    local className = instance.ClassName
    local dynamicCache = dynamicPropertySupportCache[className]
    if dynamicCache and dynamicCache[propertyName] ~= nil then
        return dynamicCache[propertyName]
    end

    local canSerialize = serializeProperty(instance, propertyName, false)
    dynamicCache[propertyName] = canSerialize
    if canSerialize then
        propertySet[propertyName] = true
    end
    return canSerialize
end

--- Collect all serializable properties for a snapshot.
local function collectPropertiesForSnapshot(instance)
    local properties = {}
    local propertySet = getTrackedPropertySet(instance)

    for propertyName, _ in pairs(propertySet) do
        local success, value = serializeProperty(instance, propertyName, true)
        if success then
            properties[propertyName] = value
        end
    end

    return properties
end

--- Serialize a Roblox Instance to a table.
--- @param instance Instance The instance to serialize
--- @param includeChildren boolean|nil Whether to recursively include children (default: true)
--- @return table Serialized instance data
local function serializeInstance(instance, includeChildren)
    if includeChildren == nil then
        includeChildren = true
    end

    local properties = collectPropertiesForSnapshot(instance)

    -- Serialize children recursively
    local children = {}
    if includeChildren then
        for _, child in ipairs(instance:GetChildren()) do
            -- Skip certain instances that shouldn't sync
            if not child:IsA("Camera") or child.Name ~= "CurrentCamera" then
                table.insert(children, serializeInstance(child, true))
            end
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
local function resolveInstanceRef(fullName)
    if type(fullName) ~= "string" or fullName == "" then
        return nil
    end

    local normalized = fullName
    if string.sub(normalized, 1, 5) == "game." then
        normalized = string.sub(normalized, 6)
    end

    local segments = {}
    for part in string.gmatch(normalized, "[^%.]+") do
        table.insert(segments, part)
    end

    if #segments == 0 then
        return nil
    end

    local current
    local success, service = pcall(function()
        return game:GetService(segments[1])
    end)
    if success and service then
        current = service
    else
        current = game:FindFirstChild(segments[1])
    end

    for i = 2, #segments do
        if not current then
            return nil
        end
        current = current:FindFirstChild(segments[i])
    end

    return current
end

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
        local enumTypeName = tostring(val.enumType or "")
        if string.sub(enumTypeName, 1, 5) == "Enum." then
            enumTypeName = string.sub(enumTypeName, 6)
        end

        local enumType = Enum[enumTypeName]
        if enumType then
            if val.name and enumType[val.name] then
                return enumType[val.name]
            end

            if type(val.value) == "number" then
                for _, item in ipairs(enumType:GetEnumItems()) do
                    if item.Value == val.value then
                        return item
                    end
                end
            end
        end
        return nil
    elseif val.type == "NumberSequence" then
        local keypoints = {}
        if type(val.keypoints) == "table" then
            for _, kp in ipairs(val.keypoints) do
                table.insert(keypoints, NumberSequenceKeypoint.new(
                    tonumber(kp.time) or 0,
                    tonumber(kp.value) or 0,
                    tonumber(kp.envelope) or 0
                ))
            end
        end
        if #keypoints > 0 then
            return NumberSequence.new(keypoints)
        end
        return nil
    elseif val.type == "ColorSequence" then
        local keypoints = {}
        if type(val.keypoints) == "table" then
            for _, kp in ipairs(val.keypoints) do
                local color = kp.value and deserializeValue(kp.value)
                if typeof(color) == "Color3" then
                    table.insert(keypoints, ColorSequenceKeypoint.new(
                        tonumber(kp.time) or 0,
                        color
                    ))
                end
            end
        end
        if #keypoints > 0 then
            return ColorSequence.new(keypoints)
        end
        return nil
    elseif val.type == "PhysicalProperties" then
        if val.density ~= nil and val.friction ~= nil and val.elasticity ~= nil and val.frictionWeight ~= nil and val.elasticityWeight ~= nil then
            return PhysicalProperties.new(
                val.density,
                val.friction,
                val.elasticity,
                val.frictionWeight,
                val.elasticityWeight
            )
        end
        return nil
    elseif val.type == "InstanceRef" then
        return resolveInstanceRef(val.path)
    elseif val.type == "Unsupported" then
        return nil
    end

    return val
end

local function serializeForAgentTestPayload(value, depth, seen)
    depth = depth or 0
    seen = seen or {}

    if depth > 5 then
        return tostring(value)
    end

    local valueType = typeof(value)
    if value == nil or valueType == "boolean" or valueType == "number" or valueType == "string" then
        return value
    elseif valueType == "Vector3" then
        return serializeVector3(value)
    elseif valueType == "Vector2" then
        return serializeVector2(value)
    elseif valueType == "CFrame" then
        return serializeCFrame(value)
    elseif valueType == "Color3" then
        return serializeColor3(value)
    elseif valueType == "UDim2" then
        return serializeUDim2(value)
    elseif valueType == "UDim" then
        return serializeUDim(value)
    elseif valueType == "BrickColor" then
        return serializeBrickColor(value)
    elseif valueType == "NumberRange" then
        return serializeNumberRange(value)
    elseif valueType == "Rect" then
        return serializeRect(value)
    elseif valueType == "EnumItem" then
        return serializeEnum(value)
    elseif valueType == "Instance" then
        return {
            type = "InstanceRef",
            path = value:GetFullName()
        }
    elseif valueType == "table" then
        if seen[value] then
            return "<circular>"
        end
        seen[value] = true
        local out = {}
        local count = 0
        for k, v in pairs(value) do
            count = count + 1
            if count > 200 then
                out["__truncated"] = true
                break
            end
            out[tostring(k)] = serializeForAgentTestPayload(v, depth + 1, seen)
        end
        seen[value] = nil
        return out
    end

    return tostring(value)
end

local function sendAgentTestEvent(runId, eventName, message, result, artifact, artifactName)
    if type(runId) ~= "string" or runId == "" then
        return
    end

    spawn(function()
        local payload = {
            runId = runId,
            event = eventName,
            timestamp = os.time(),
        }

        if runId == currentAgentTestRunId and type(currentAgentTestAttempt) == "number" and currentAgentTestAttempt >= 1 then
            payload.attempt = currentAgentTestAttempt
        end

        if message ~= nil then
            payload.message = tostring(message)
        end
        if result ~= nil then
            payload.result = serializeForAgentTestPayload(result)
        end
        if artifact ~= nil then
            payload.artifact = serializeForAgentTestPayload(artifact)
            payload.artifactName = type(artifactName) == "string" and artifactName or "artifact"
        end

        request("POST", "/agent/tests/events", payload)
    end)
end

local function sendAgentTestArtifact(runId, artifactName, artifactPayload, message, result)
    sendAgentTestEvent(
        runId,
        "artifact",
        message,
        result,
        artifactPayload,
        artifactName
    )
end

local function sendAgentTestBinaryArtifact(runId, artifactName, mimeType, base64Data, message, result)
    if type(runId) ~= "string" or runId == "" then
        return
    end
    if type(base64Data) ~= "string" or base64Data == "" then
        return
    end

    spawn(function()
        local payload = {
            runId = runId,
            event = "artifact",
            timestamp = os.time(),
            artifactName = type(artifactName) == "string" and artifactName or "artifact",
            artifactMimeType = type(mimeType) == "string" and mimeType or "application/octet-stream",
            artifactBase64 = base64Data,
        }
        if runId == currentAgentTestRunId and type(currentAgentTestAttempt) == "number" and currentAgentTestAttempt >= 1 then
            payload.attempt = currentAgentTestAttempt
        end
        if message ~= nil then
            payload.message = tostring(message)
        end
        if result ~= nil then
            payload.result = serializeForAgentTestPayload(result)
        end

        request("POST", "/agent/tests/events", payload)
    end)
end

local function normalizePathInput(pathInput)
    local path = {}

    if type(pathInput) == "table" then
        for _, part in ipairs(pathInput) do
            if type(part) == "string" and part ~= "" then
                table.insert(path, part)
            end
        end
    elseif type(pathInput) == "string" and pathInput ~= "" then
        for part in string.gmatch(pathInput, "[^%.]+") do
            table.insert(path, part)
        end
    end

    return path
end

local function resolveInstanceByPath(pathInput)
    local path = normalizePathInput(pathInput)
    if #path == 0 then
        return nil
    end

    local current = game
    for i, name in ipairs(path) do
        if i == 1 then
            local success, service = pcall(function()
                return game:GetService(name)
            end)
            if success then
                current = service
            else
                current = game:FindFirstChild(name)
            end
        else
            current = current and current:FindFirstChild(name)
        end

        if not current then
            return nil
        end
    end

    return current
end

local function valuesEqualForTest(actual, expected)
    if actual == expected then
        return true
    end

    local actualType = typeof(actual)
    local expectedType = typeof(expected)
    if actualType ~= expectedType then
        return false
    end

    if actualType == "table" then
        local successA, encodedA = pcall(function()
            return HttpService:JSONEncode(actual)
        end)
        local successB, encodedB = pcall(function()
            return HttpService:JSONEncode(expected)
        end)
        if successA and successB then
            return encodedA == encodedB
        end
    end

    return tostring(actual) == tostring(expected)
end

local function waitWithAbort(seconds)
    local remaining = tonumber(seconds) or 0
    while remaining > 0 do
        if currentAgentTestAbortRequested then
            return false
        end

        local step = math.min(0.1, remaining)
        task.wait(step)
        remaining = remaining - step
    end
    return not currentAgentTestAbortRequested
end

local function isDestructiveTestStepType(stepType)
    return stepType == "setProperty"
        or stepType == "createInstance"
        or stepType == "destroyInstance"
        or stepType == "renameInstance"
        or stepType == "reparentInstance"
end

local function splitTargetPathForCreation(step)
    local parentPath = normalizePathInput(step.parentPath)
    local name = step.name

    local fullPath = normalizePathInput(step.path)
    if #fullPath > 0 then
        if #fullPath > 1 then
            parentPath = {}
            for i = 1, #fullPath - 1 do
                table.insert(parentPath, fullPath[i])
            end
        end
        name = fullPath[#fullPath]
    end

    return parentPath, name
end

local function applyPropertiesToTestInstance(instance, properties)
    if type(properties) ~= "table" then
        return
    end

    for propName, rawValue in pairs(properties) do
        if type(propName) == "string" and propName ~= "" then
            local parsedValue = deserializeValue(rawValue)
            pcall(function()
                instance[propName] = parsedValue
            end)
        end
    end
end

local function callServiceMethod(service, methodName)
    local method = service and service[methodName]
    if type(method) ~= "function" then
        return false, "method_not_found"
    end

    local ok, err = pcall(function()
        method(service)
    end)
    if not ok then
        return false, tostring(err)
    end
    return true, nil
end

local function callServiceMethodWithArgs(service, methodName, ...)
    local method = service and service[methodName]
    if type(method) ~= "function" then
        return false, "method_not_found"
    end

    local ok, resultOrErr = pcall(function(...)
        return method(service, ...)
    end, ...)
    if not ok then
        return false, tostring(resultOrErr)
    end
    return true, resultOrErr
end

local function beginAgentRuntimeSession(runId, scenario, suppressSyncChanges)
    local runtime = scenario and scenario.runtime
    if type(runtime) ~= "table" then
        runtime = {}
    end

    local mode = runtime.mode
    if type(mode) ~= "string" then
        mode = "none"
    end
    mode = string.lower(mode)
    if mode ~= "run" and mode ~= "play" then
        mode = "none"
    end

    local runtimeInfo = {
        requestedMode = mode,
        started = false,
        startSource = nil,
        startError = nil,
        stopSource = nil,
        stopped = false,
        suppressSyncChanges = suppressSyncChanges == true,
    }

    if mode == "none" then
        return function() end, runtimeInfo
    end

    local startCandidates = {}
    if mode == "play" then
        startCandidates = {
            { service = TestService, method = "ExecuteWithStudioRun", label = "TestService.ExecuteWithStudioRun" },
            { service = TestService, method = "Start", label = "TestService.Start" },
            { service = TestService, method = "Run", label = "TestService.Run" },
            { service = RunService, method = "Run", label = "RunService.Run" },
        }
    else
        startCandidates = {
            { service = TestService, method = "Run", label = "TestService.Run" },
            { service = TestService, method = "Start", label = "TestService.Start" },
            { service = RunService, method = "Run", label = "RunService.Run" },
        }
    end

    local lastErr = nil
    for _, candidate in ipairs(startCandidates) do
        local wrappedOk, wrappedResult = runWithSuppressedSync(function()
            local ok, err = callServiceMethod(candidate.service, candidate.method)
            return {
                ok = ok,
                err = err,
            }
        end, suppressSyncChanges == true)

        if wrappedOk and wrappedResult and wrappedResult.ok then
            runtimeInfo.started = true
            runtimeInfo.startSource = candidate.label
            break
        end

        local err = nil
        if wrappedOk then
            err = wrappedResult and wrappedResult.err
        else
            err = wrappedResult
        end
        if err and err ~= "method_not_found" then
            lastErr = err
        end
    end

    if runtimeInfo.started then
        sendAgentTestEvent(runId, "log", "Runtime session started via " .. tostring(runtimeInfo.startSource))
    else
        runtimeInfo.startError = lastErr or "no supported runtime start method available"
        sendAgentTestEvent(runId, "log", "Runtime mode '" .. mode .. "' could not be started: " .. tostring(runtimeInfo.startError))
    end

    return function()
        if runtime.stopOnFinish == false then
            return
        end

        local stopCandidates = {
            { service = TestService, method = "Stop", label = "TestService.Stop" },
            { service = RunService, method = "Stop", label = "RunService.Stop" },
        }

        for _, candidate in ipairs(stopCandidates) do
            local wrappedOk, wrappedResult = runWithSuppressedSync(function()
                local ok, err = callServiceMethod(candidate.service, candidate.method)
                return {
                    ok = ok,
                    err = err,
                }
            end, suppressSyncChanges == true)

            if wrappedOk and wrappedResult and wrappedResult.ok then
                runtimeInfo.stopped = true
                runtimeInfo.stopSource = candidate.label
                sendAgentTestEvent(runId, "log", "Runtime session stopped via " .. tostring(candidate.label))
                return
            end
        end
    end, runtimeInfo
end

local function runWithSuppressedSync(callback, suppressSync)
    if suppressSync ~= true then
        return pcall(callback)
    end

    local previous = isApplyingAgentTestIsolationChange
    isApplyingAgentTestIsolationChange = true
    local ok, result = pcall(callback)
    isApplyingAgentTestIsolationChange = previous
    return ok, result
end

local function getInstanceIsolationKey(instance)
    if not instance then
        return nil
    end

    local okDebug, debugId = pcall(function()
        return instance:GetDebugId()
    end)
    if okDebug and type(debugId) == "string" and debugId ~= "" then
        return debugId
    end

    local okName, fullName = pcall(function()
        return instance:GetFullName()
    end)
    if okName and type(fullName) == "string" and fullName ~= "" then
        return fullName
    end

    return tostring(instance)
end

local classInstantiationSupportCache = {}

local function canInstantiateClass(className)
    if type(className) ~= "string" or className == "" then
        return false
    end

    local cached = classInstantiationSupportCache[className]
    if cached ~= nil then
        return cached
    end

    local ok, probe = pcall(function()
        return Instance.new(className)
    end)
    if ok and probe then
        pcall(function()
            probe:Destroy()
        end)
        classInstantiationSupportCache[className] = true
        return true
    end

    classInstantiationSupportCache[className] = false
    return false
end

local function normalizeIsolationClassSet(raw)
    local out = {}
    if type(raw) ~= "table" then
        return out
    end

    for _, value in pairs(raw) do
        if type(value) == "string" then
            local trimmed = string.gsub(value, "^%s*(.-)%s*$", "%1")
            if trimmed ~= "" then
                out[trimmed] = true
            end
        end
    end

    return out
end

local function getRootServiceNameFromPath(pathParts)
    if type(pathParts) == "table" and #pathParts > 0 then
        return pathParts[1]
    end
    return nil
end

local function createAgentTestMutationJournal(isolationConfig)
    local isolation = isolationConfig
    if type(isolation) ~= "table" then
        isolation = {}
    end

    local enabled = isolation.enabled ~= false and isolation.revertChanges ~= false and isolation.cleanupMutations ~= false
    local suppressSyncChanges = isolation.suppressSyncChanges ~= false
    local cleanupCreatedInstances = isolation.cleanupCreatedInstances ~= false
    local restoreDestroyedInstances = isolation.restoreDestroyedInstances ~= false
    local restorePropertyChanges = isolation.restorePropertyChanges ~= false
    local skipDestroyedRuntimeOwned = isolation.skipDestroyedRuntimeOwned ~= false
    local allowSnapshotRestoreForNonCloneable = isolation.allowSnapshotRestoreForNonCloneable ~= false
    local ignoreMissingDestroyedRestoreParent = isolation.ignoreMissingDestroyedRestoreParent ~= false
    local skipDestroyedRestoreClasses = normalizeIsolationClassSet(
        isolation.skipDestroyedRestoreClasses or isolation.skipRestoreClassNames
    )

    if not enabled then
        suppressSyncChanges = false
        cleanupCreatedInstances = false
        restoreDestroyedInstances = false
        restorePropertyChanges = false
        skipDestroyedRuntimeOwned = false
        allowSnapshotRestoreForNonCloneable = false
        ignoreMissingDestroyedRestoreParent = false
        skipDestroyedRestoreClasses = {}
    end

    return {
        enabled = enabled,
        suppressSyncChanges = suppressSyncChanges,
        cleanupCreatedInstances = cleanupCreatedInstances,
        restoreDestroyedInstances = restoreDestroyedInstances,
        restorePropertyChanges = restorePropertyChanges,
        skipDestroyedRuntimeOwned = skipDestroyedRuntimeOwned,
        allowSnapshotRestoreForNonCloneable = allowSnapshotRestoreForNonCloneable,
        ignoreMissingDestroyedRestoreParent = ignoreMissingDestroyedRestoreParent,
        skipDestroyedRestoreClasses = skipDestroyedRestoreClasses,
        executeHarnessCleanupHandlers = true,
        propertyRestores = {},
        propertyRestoreKeys = {},
        createdInstances = {},
        createdInstanceKeys = {},
        destroyedInstances = {},
        destroyedInstanceKeys = {},
        skippedDestroyedRecords = 0,
        harnessCleanupHandlers = {},
    }
end

local function journalCaptureProperty(journal, instance, propertyName)
    if type(journal) ~= "table" or journal.enabled ~= true then
        return
    end
    if journal.restorePropertyChanges ~= true then
        return
    end
    if not instance or type(propertyName) ~= "string" or propertyName == "" then
        return
    end

    local instanceKey = getInstanceIsolationKey(instance)
    if not instanceKey then
        return
    end
    local key = instanceKey .. "::" .. propertyName
    if journal.propertyRestoreKeys[key] then
        return
    end

    local ok, value = pcall(function()
        return instance[propertyName]
    end)
    if not ok then
        return
    end

    journal.propertyRestoreKeys[key] = true
    table.insert(journal.propertyRestores, {
        instance = instance,
        property = propertyName,
        value = value,
    })
end

local function journalTrackCreatedInstance(journal, instance)
    if type(journal) ~= "table" or journal.enabled ~= true then
        return
    end
    if journal.cleanupCreatedInstances ~= true then
        return
    end
    if not instance then
        return
    end

    local key = getInstanceIsolationKey(instance)
    if key then
        journal.createdInstanceKeys[key] = true
    end
    table.insert(journal.createdInstances, instance)
end

local function journalTrackDestroyedInstance(journal, instance)
    if type(journal) ~= "table" or journal.enabled ~= true then
        return
    end
    if journal.restoreDestroyedInstances ~= true then
        return
    end
    if not instance then
        return
    end

    local key = getInstanceIsolationKey(instance)
    if not key then
        return
    end
    if journal.destroyedInstanceKeys[key] then
        return
    end
    if journal.createdInstanceKeys[key] then
        return
    end

    local parent = nil
    local okParent, parentOrErr = pcall(function()
        return instance.Parent
    end)
    if okParent then
        parent = parentOrErr
    end

    local parentPath = nil
    if parent then
        local okName, parentFullName = pcall(function()
            return parent:GetFullName()
        end)
        if okName and type(parentFullName) == "string" and parentFullName ~= "" then
            parentPath = normalizePathInput(parentFullName)
        end
    end

    local instanceClassName = instance.ClassName
    if journal.skipDestroyedRestoreClasses and journal.skipDestroyedRestoreClasses[instanceClassName] then
        journal.skippedDestroyedRecords = (tonumber(journal.skippedDestroyedRecords) or 0) + 1
        return
    end

    local parentRootService = getRootServiceNameFromPath(parentPath)
    if journal.skipDestroyedRuntimeOwned == true and parentRootService == "Players" then
        journal.skippedDestroyedRecords = (tonumber(journal.skippedDestroyedRecords) or 0) + 1
        return
    end

    local clone = nil
    local okClone, cloneOrErr = pcall(function()
        return instance:Clone()
    end)
    if okClone then
        clone = cloneOrErr
    end

    local snapshot = nil
    if not clone and journal.allowSnapshotRestoreForNonCloneable == true then
        local okSnapshot, snapshotOrErr = pcall(function()
            return serializeInstance(instance, true)
        end)
        if okSnapshot then
            snapshot = snapshotOrErr
        end
    end

    if not clone and snapshot and not canInstantiateClass(instanceClassName) then
        snapshot = nil
    end

    if not clone and not snapshot then
        journal.skippedDestroyedRecords = (tonumber(journal.skippedDestroyedRecords) or 0) + 1
        return
    end

    journal.destroyedInstanceKeys[key] = true
    table.insert(journal.destroyedInstances, {
        key = key,
        clone = clone,
        snapshot = snapshot,
        parent = parent,
        parentPath = parentPath,
        name = instance.Name,
        className = instanceClassName,
    })
end

local function journalTrackHarnessCleanupHandler(journal, handler, source)
    if type(journal) ~= "table" or journal.enabled ~= true then
        return false
    end
    if journal.executeHarnessCleanupHandlers ~= true then
        return false
    end
    if type(handler) ~= "function" then
        return false
    end

    table.insert(journal.harnessCleanupHandlers, {
        handler = handler,
        source = source,
    })
    return true
end

local function executeDeclarativeHarnessCleanupStep(step, cleanupContext)
    if type(step) ~= "table" then
        return false, "cleanup step must be an object"
    end

    local stepType = type(step.type) == "string" and step.type or ""
    local suppressSync = cleanupContext and cleanupContext.isolation and cleanupContext.isolation.suppressSyncChanges == true

    if stepType == "log" then
        return true
    elseif stepType == "wait" then
        local waitSeconds = tonumber(step.seconds or step.duration or 0) or 0
        if waitSeconds < 0 then
            waitSeconds = 0
        end
        local ok = waitWithAbort(waitSeconds)
        if not ok then
            return false, "cleanup wait aborted"
        end
        return true
    elseif stepType == "destroyInstance" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            if step.ignoreMissing == true then
                return true
            end
            return false, "cleanup destroyInstance: target not found"
        end
        local ok, err = runWithSuppressedSync(function()
            target:Destroy()
        end, suppressSync)
        if not ok then
            return false, "cleanup destroyInstance failed: " .. tostring(err)
        end
        return true
    elseif stepType == "setProperty" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            return false, "cleanup setProperty: target not found"
        end
        local propertyName = step.property
        if type(propertyName) ~= "string" or propertyName == "" then
            return false, "cleanup setProperty: property missing"
        end
        local value = deserializeValue(step.value)
        local ok, err = runWithSuppressedSync(function()
            target[propertyName] = value
        end, suppressSync)
        if not ok then
            return false, "cleanup setProperty failed: " .. tostring(err)
        end
        return true
    elseif stepType == "renameInstance" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            return false, "cleanup renameInstance: target not found"
        end
        local newName = step.name or step.newName
        if type(newName) ~= "string" or newName == "" then
            return false, "cleanup renameInstance: new name missing"
        end
        local ok, err = runWithSuppressedSync(function()
            target.Name = newName
        end, suppressSync)
        if not ok then
            return false, "cleanup renameInstance failed: " .. tostring(err)
        end
        return true
    elseif stepType == "reparentInstance" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            return false, "cleanup reparentInstance: target not found"
        end
        local newParent = resolveInstanceByPath(step.newParentPath or step.parentPath)
        if not newParent then
            return false, "cleanup reparentInstance: new parent not found"
        end
        local ok, err = runWithSuppressedSync(function()
            target.Parent = newParent
            local newName = step.newName
            if type(newName) == "string" and newName ~= "" then
                target.Name = newName
            end
        end, suppressSync)
        if not ok then
            return false, "cleanup reparentInstance failed: " .. tostring(err)
        end
        return true
    end

    return false, "unsupported cleanup step type: " .. tostring(stepType)
end

local function executeDeclarativeHarnessCleanupSteps(cleanupSteps, cleanupContext)
    if type(cleanupSteps) ~= "table" then
        return false, "cleanupSteps must be an array"
    end

    for i = #cleanupSteps, 1, -1 do
        local step = cleanupSteps[i]
        local ok, err = executeDeclarativeHarnessCleanupStep(step, cleanupContext)
        if not ok then
            return false, "cleanup step " .. tostring(i) .. " failed: " .. tostring(err)
        end
    end

    return true, nil
end

local function journalTrackHarnessCleanupFromResponse(journal, response, source)
    if type(response) ~= "table" then
        return false
    end

    local handler = response.cleanup
    if type(handler) ~= "function" then
        handler = response.Cleanup
    end
    if type(handler) ~= "function" then
        handler = response.cleanupHandler
    end
    if type(handler) ~= "function" then
        handler = response.CleanupHandler
    end

    if type(handler) ~= "function" then
        local cleanupSteps = nil
        if type(response.cleanupSteps) == "table" then
            cleanupSteps = response.cleanupSteps
        elseif type(response.CleanupSteps) == "table" then
            cleanupSteps = response.CleanupSteps
        end

        if cleanupSteps then
            handler = function(cleanupContext)
                local ok, err = executeDeclarativeHarnessCleanupSteps(cleanupSteps, cleanupContext)
                if not ok then
                    error(err)
                end
            end
        end
    end

    return journalTrackHarnessCleanupHandler(journal, handler, source)
end

local function resolveDestroyedRestoreParent(record)
    if not record then
        return nil
    end

    local parent = record.parent
    if parent then
        local okParent, parentParent = pcall(function()
            return parent.Parent
        end)
        if okParent and parentParent ~= nil then
            return parent
        end
    end

    if type(record.parentPath) == "table" and #record.parentPath > 0 then
        return resolveInstanceByPath(record.parentPath)
    end

    return nil
end

local function shouldSkipSnapshotRestoreProperty(propertyName)
    return propertyName == "Name"
        or propertyName == "Parent"
        or propertyName == "ClassName"
        or propertyName == "Children"
end

local function restoreDestroyedInstanceFromSnapshot(snapshotNode, parent)
    if type(snapshotNode) ~= "table" then
        return false, "invalid_snapshot_node", 0
    end

    local className = snapshotNode.className
    if type(className) ~= "string" or className == "" then
        return false, "snapshot_missing_className", 0
    end

    local instance = Instance.new(className)
    local name = snapshotNode.name
    if type(name) == "string" and name ~= "" then
        instance.Name = name
    end

    local setFailures = 0
    local properties = snapshotNode.properties
    if type(properties) == "table" then
        local sourceValue = properties.Source
        if sourceValue ~= nil and instance:IsA("LuaSourceContainer") then
            local parsedSource = deserializeValue(sourceValue)
            local okSource = pcall(function()
                instance.Source = parsedSource
            end)
            if not okSource then
                setFailures = setFailures + 1
            end
        end

        for propertyName, serializedValue in pairs(properties) do
            if type(propertyName) == "string" and not shouldSkipSnapshotRestoreProperty(propertyName) and propertyName ~= "Source" then
                local parsedValue = deserializeValue(serializedValue)
                local okSet = pcall(function()
                    instance[propertyName] = parsedValue
                end)
                if not okSet then
                    setFailures = setFailures + 1
                end
            end
        end
    end

    instance.Parent = parent

    local restoredNodes = 1
    local children = snapshotNode.children
    if type(children) == "table" then
        for _, childSnapshot in ipairs(children) do
            local childOk, childErr, childCount = restoreDestroyedInstanceFromSnapshot(childSnapshot, instance)
            if childOk then
                restoredNodes = restoredNodes + (tonumber(childCount) or 0)
            else
                setFailures = setFailures + 1
                warn("[uxrCoder] Snapshot child restore failed:", tostring(childErr))
            end
        end
    end

    return true, nil, restoredNodes, setFailures
end

local function applyAgentTestMutationCleanup(runId, journal)
    if type(journal) ~= "table" or journal.enabled ~= true then
        return {
            enabled = false,
        }
    end

    local summary = {
        enabled = true,
        suppressSyncChanges = journal.suppressSyncChanges == true,
        cleanupCreatedInstances = journal.cleanupCreatedInstances == true,
        restoreDestroyedInstances = journal.restoreDestroyedInstances == true,
        restorePropertyChanges = journal.restorePropertyChanges == true,
        skippedDestroyedRestoreRecords = tonumber(journal.skippedDestroyedRecords) or 0,
        executedHarnessCleanupHandlers = 0,
        restoredProperties = 0,
        restoredDestroyedInstances = 0,
        restoredDestroyedFromSnapshot = 0,
        restoredDestroyedSnapshotNodes = 0,
        cleanedCreatedInstances = 0,
        failures = 0,
    }

    if journal.executeHarnessCleanupHandlers == true then
        for i = #journal.harnessCleanupHandlers, 1, -1 do
            local entry = journal.harnessCleanupHandlers[i]
            if entry and type(entry.handler) == "function" then
                local ok = runWithSuppressedSync(function()
                    local cleanupContext = {
                        runId = runId,
                        source = entry.source,
                        isolation = {
                            suppressSyncChanges = journal.suppressSyncChanges == true,
                        },
                    }
                    entry.handler(cleanupContext)
                end, journal.suppressSyncChanges == true)

                if ok then
                    summary.executedHarnessCleanupHandlers = summary.executedHarnessCleanupHandlers + 1
                else
                    summary.failures = summary.failures + 1
                end
            else
                summary.failures = summary.failures + 1
            end
        end
    end

    if journal.cleanupCreatedInstances == true then
        for i = #journal.createdInstances, 1, -1 do
            local created = journal.createdInstances[i]
            if created then
                local okParent, parent = pcall(function()
                    return created.Parent
                end)
                if okParent and parent ~= nil then
                    local ok = runWithSuppressedSync(function()
                        created:Destroy()
                    end, journal.suppressSyncChanges == true)
                    if ok then
                        summary.cleanedCreatedInstances = summary.cleanedCreatedInstances + 1
                    else
                        summary.failures = summary.failures + 1
                    end
                end
            end
        end
    end

    if journal.restoreDestroyedInstances == true then
        for i = #journal.destroyedInstances, 1, -1 do
            local record = journal.destroyedInstances[i]
            if record and (record.clone or record.snapshot) then
                local parent = resolveDestroyedRestoreParent(record)
                if parent then
                    local ok = false
                    local restoreResult = nil
                    if record.clone then
                        ok, restoreResult = runWithSuppressedSync(function()
                            record.clone.Parent = parent
                            if type(record.name) == "string" and record.name ~= "" and record.clone.Name ~= record.name then
                                record.clone.Name = record.name
                            end
                            return {
                                restoredFrom = "clone",
                            }
                        end, journal.suppressSyncChanges == true)
                    else
                        ok, restoreResult = runWithSuppressedSync(function()
                            local snapshotOk, snapshotErr, restoredCount, setFailures = restoreDestroyedInstanceFromSnapshot(record.snapshot, parent)
                            if not snapshotOk then
                                error(tostring(snapshotErr))
                            end
                            return {
                                restoredFrom = "snapshot",
                                restoredCount = restoredCount,
                                setFailures = setFailures,
                            }
                        end, journal.suppressSyncChanges == true)
                    end

                    if ok then
                        summary.restoredDestroyedInstances = summary.restoredDestroyedInstances + 1
                        if type(restoreResult) == "table" and restoreResult.restoredFrom == "snapshot" then
                            summary.restoredDestroyedFromSnapshot = summary.restoredDestroyedFromSnapshot + 1
                            summary.restoredDestroyedSnapshotNodes = summary.restoredDestroyedSnapshotNodes + (tonumber(restoreResult.restoredCount) or 0)
                            summary.failures = summary.failures + (tonumber(restoreResult.setFailures) or 0)
                        end
                    else
                        summary.failures = summary.failures + 1
                    end
                else
                    if journal.ignoreMissingDestroyedRestoreParent == true then
                        summary.skippedDestroyedRestoreRecords = summary.skippedDestroyedRestoreRecords + 1
                    else
                        summary.failures = summary.failures + 1
                    end
                end
            end
        end
    end

    if journal.restorePropertyChanges == true then
        for i = #journal.propertyRestores, 1, -1 do
            local restore = journal.propertyRestores[i]
            if restore and restore.instance and type(restore.property) == "string" then
                local ok = runWithSuppressedSync(function()
                    restore.instance[restore.property] = restore.value
                end, journal.suppressSyncChanges == true)
                if ok then
                    summary.restoredProperties = summary.restoredProperties + 1
                else
                    summary.failures = summary.failures + 1
                end
            else
                summary.failures = summary.failures + 1
            end
        end
    end

    sendAgentTestEvent(
        runId,
        "log",
        "Isolation cleanup: harnessHandlers=" .. tostring(summary.executedHarnessCleanupHandlers)
            .. ", restoredProperties=" .. tostring(summary.restoredProperties)
            .. ", restoredDestroyedInstances=" .. tostring(summary.restoredDestroyedInstances)
            .. " (snapshot=" .. tostring(summary.restoredDestroyedFromSnapshot)
            .. ", snapshotNodes=" .. tostring(summary.restoredDestroyedSnapshotNodes) .. ")"
            .. ", skippedDestroyedRestoreRecords=" .. tostring(summary.skippedDestroyedRestoreRecords)
            .. ", cleanedCreatedInstances=" .. tostring(summary.cleanedCreatedInstances)
            .. ", failures=" .. tostring(summary.failures),
        summary
    )

    return summary
end

local function getPlayableCharacter()
    local localPlayer = Players.LocalPlayer
    if localPlayer and localPlayer.Character then
        return localPlayer.Character
    end

    local players = Players:GetPlayers()
    for _, player in ipairs(players) do
        if player.Character then
            return player.Character
        end
    end

    return nil
end

local function resolveTeleportCFrame(target)
    if not target then
        return nil
    end

    if target:IsA("BasePart") then
        return target.CFrame
    end
    if target:IsA("Attachment") then
        return target.WorldCFrame
    end
    if target:IsA("Model") then
        local ok, pivot = pcall(function()
            return target:GetPivot()
        end)
        if ok then
            return pivot
        end
    end

    return nil
end

local function resolvePlayableCharacterRig()
    local character = getPlayableCharacter()
    if not character then
        return nil, nil, nil, "no playable character"
    end

    local humanoid = character:FindFirstChildOfClass("Humanoid")
    if not humanoid then
        return character, nil, nil, "humanoid not found"
    end

    local root = character.PrimaryPart or character:FindFirstChild("HumanoidRootPart")
    if not root or not root:IsA("BasePart") then
        return character, humanoid, nil, "character root part missing"
    end

    return character, humanoid, root, nil
end

local function collectExpectedStateNames(step)
    local expected = {}
    if type(step.state) == "string" and step.state ~= "" then
        table.insert(expected, step.state)
    end
    if type(step.equals) == "string" and step.equals ~= "" then
        table.insert(expected, step.equals)
    end
    if type(step.anyOf) == "table" then
        for _, candidate in ipairs(step.anyOf) do
            if type(candidate) == "string" and candidate ~= "" then
                table.insert(expected, candidate)
            end
        end
    end
    return expected
end

local function toCFrame(input)
    local parsed = deserializeValue(input)
    local parsedType = typeof(parsed)
    if parsedType == "CFrame" then
        return parsed
    end
    if parsedType == "Vector3" then
        return CFrame.new(parsed)
    end
    return nil
end

local function executeBuiltinHarnessAction(action, payload, step, context)
    local journal = context and context.mutationJournal or nil
    local suppressSync = context and context.suppressSyncChanges == true

    if action == "teleportPlayerToPath" then
        local target = resolveInstanceByPath(payload.path or step.path)
        if not target then
            return false, "teleportPlayerToPath failed: target not found"
        end

        local destination = resolveTeleportCFrame(target)
        if not destination then
            return false, "teleportPlayerToPath failed: target has no teleportable transform"
        end

        local character = getPlayableCharacter()
        if not character then
            return false, "teleportPlayerToPath failed: no playable character"
        end

        local root = character.PrimaryPart or character:FindFirstChild("HumanoidRootPart")
        if not root then
            return false, "teleportPlayerToPath failed: character root part missing"
        end

        journalCaptureProperty(journal, root, "CFrame")
        local ok, err = runWithSuppressedSync(function()
            root.CFrame = destination
        end, suppressSync)
        if not ok then
            return false, "teleportPlayerToPath failed: " .. tostring(err)
        end

        return true, nil, {
            source = "builtin",
            action = action,
            character = character:GetFullName(),
            destination = serializeCFrame(destination),
        }
    elseif action == "teleportPlayerToCFrame" then
        local destination = toCFrame(payload.cframe or step.cframe or step.value)
        if not destination then
            return false, "teleportPlayerToCFrame failed: cframe value missing/invalid"
        end

        local character = getPlayableCharacter()
        if not character then
            return false, "teleportPlayerToCFrame failed: no playable character"
        end

        local root = character.PrimaryPart or character:FindFirstChild("HumanoidRootPart")
        if not root then
            return false, "teleportPlayerToCFrame failed: character root part missing"
        end

        journalCaptureProperty(journal, root, "CFrame")
        local ok, err = runWithSuppressedSync(function()
            root.CFrame = destination
        end, suppressSync)
        if not ok then
            return false, "teleportPlayerToCFrame failed: " .. tostring(err)
        end

        return true, nil, {
            source = "builtin",
            action = action,
            character = character:GetFullName(),
            destination = serializeCFrame(destination),
        }
    elseif action == "setHumanoidWalkSpeed" then
        local speed = tonumber(payload.speed or step.speed)
        if not speed then
            return false, "setHumanoidWalkSpeed failed: speed missing"
        end

        local character = getPlayableCharacter()
        if not character then
            return false, "setHumanoidWalkSpeed failed: no playable character"
        end

        local humanoid = character:FindFirstChildOfClass("Humanoid")
        if not humanoid then
            return false, "setHumanoidWalkSpeed failed: humanoid not found"
        end

        journalCaptureProperty(journal, humanoid, "WalkSpeed")
        local ok, err = runWithSuppressedSync(function()
            humanoid.WalkSpeed = speed
        end, suppressSync)
        if not ok then
            return false, "setHumanoidWalkSpeed failed: " .. tostring(err)
        end

        return true, nil, {
            source = "builtin",
            action = action,
            character = character:GetFullName(),
            speed = speed,
        }
    elseif action == "moveToPath" then
        local target = resolveInstanceByPath(payload.path or step.path)
        if not target then
            return false, "moveToPath failed: target not found"
        end

        local position
        if target:IsA("BasePart") then
            position = target.Position
        elseif target:IsA("Attachment") then
            position = target.WorldPosition
        else
            return false, "moveToPath failed: target must be BasePart or Attachment"
        end

        local character = getPlayableCharacter()
        if not character then
            return false, "moveToPath failed: no playable character"
        end

        local humanoid = character:FindFirstChildOfClass("Humanoid")
        if not humanoid then
            return false, "moveToPath failed: humanoid not found"
        end

        local root = character.PrimaryPart or character:FindFirstChild("HumanoidRootPart")
        if root then
            journalCaptureProperty(journal, root, "CFrame")
        end

        local ok, err = runWithSuppressedSync(function()
            humanoid:MoveTo(position)
        end, suppressSync)
        if not ok then
            return false, "moveToPath failed: " .. tostring(err)
        end

        return true, nil, {
            source = "builtin",
            action = action,
            character = character:GetFullName(),
            destination = serializeVector3(position),
        }
    end

    return false, "Unknown built-in harness action: " .. tostring(action)
end

local function normalizeScreenshotDimensions(width, height)
    local resolvedWidth = math.floor(tonumber(width) or 1024)
    local resolvedHeight = math.floor(tonumber(height) or 576)

    if resolvedWidth < 64 then resolvedWidth = 64 end
    if resolvedHeight < 64 then resolvedHeight = 64 end
    if resolvedWidth > 4096 then resolvedWidth = 4096 end
    if resolvedHeight > 4096 then resolvedHeight = 4096 end

    return resolvedWidth, resolvedHeight
end

local function parseImageDataUri(value)
    if type(value) ~= "string" then
        return nil, nil
    end

    local mimeType, base64Data = string.match(value, "^data:([^;]+);base64,(.+)$")
    if mimeType and base64Data then
        return mimeType, base64Data
    end

    return nil, nil
end

local function extractImagePayloadFromCaptureResult(captureResult)
    if captureResult == nil then
        return nil, nil, nil
    end

    local resultType = typeof(captureResult)
    if resultType == "string" then
        local mimeType, base64Data = parseImageDataUri(captureResult)
        if mimeType and base64Data then
            return mimeType, base64Data, nil
        end
        return nil, nil, {
            rawResult = captureResult
        }
    end

    if resultType == "table" then
        local rawTable = captureResult
        local mimeType = rawTable.mimeType or rawTable.MimeType
        local base64Data = rawTable.base64 or rawTable.Base64
        if type(base64Data) ~= "string" then
            local dataUri = rawTable.dataUri or rawTable.DataUri
            mimeType, base64Data = parseImageDataUri(dataUri)
        end

        if type(base64Data) == "string" and base64Data ~= "" then
            if type(mimeType) ~= "string" or mimeType == "" then
                mimeType = "image/png"
            end
            return mimeType, base64Data, {
                rawResult = serializeForAgentTestPayload(rawTable)
            }
        end

        return nil, nil, {
            rawResult = serializeForAgentTestPayload(rawTable)
        }
    end

    return nil, nil, {
        rawResult = tostring(captureResult)
    }
end

local function attemptScreenshotCapture(width, height)
    local okService, thumbnailService = pcall(function()
        return game:GetService("ThumbnailGenerator")
    end)
    if not okService or not thumbnailService then
        return false, nil, "ThumbnailGenerator service is unavailable"
    end

    local attempts = {
        { method = "Click", args = { "PNG", width, height, true } },
        { method = "Click", args = { "png", width, height, true } },
        { method = "Click", args = { width, height, true } },
        { method = "Click", args = { "PNG", width, height } },
        { method = "Click", args = { width, height } },
        { method = "Click", args = {} },
    }

    local lastError = nil
    for _, attempt in ipairs(attempts) do
        local ok, resultOrErr = callServiceMethodWithArgs(
            thumbnailService,
            attempt.method,
            table.unpack(attempt.args)
        )
        if ok and resultOrErr ~= nil then
            return true, resultOrErr, nil
        end
        if not ok and resultOrErr ~= "method_not_found" then
            lastError = resultOrErr
        end
    end

    return false, nil, lastError or "No supported ThumbnailGenerator capture signature succeeded"
end

local function resolveScreenshotBaselineOptions(step, fallbackName)
    local explicitKey = type(step.baselineKey) == "string" and step.baselineKey or nil
    local hasExplicitKey = explicitKey and explicitKey ~= ""
    local requestsBaseline = hasExplicitKey
        or step.compareBaseline == true
        or step.recordBaseline == true
        or type(step.baselineMode) == "string"

    if not requestsBaseline then
        return nil, nil, false
    end

    local baselineKey = hasExplicitKey and explicitKey or fallbackName
    local baselineMode = step.baselineMode
    if type(baselineMode) ~= "string" or baselineMode == "" then
        if step.recordBaseline == true then
            baselineMode = "record"
        elseif step.compareBaseline == true then
            baselineMode = "assert"
        else
            baselineMode = "assert_or_record"
        end
    end

    baselineMode = string.lower(tostring(baselineMode))
    if baselineMode ~= "assert" and baselineMode ~= "record" and baselineMode ~= "assert_or_record" and baselineMode ~= "auto" then
        baselineMode = "assert"
    end

    local allowMissing = step.baselineAllowMissing == true
    return baselineKey, baselineMode, allowMissing
end

local function resolveHarnessInstance(step)
    local byPath = resolveInstanceByPath(step.runnerPath)
    if byPath then
        return byPath
    end

    local runnerName = type(step.runnerName) == "string" and step.runnerName or "uxrAgentTestRunner"
    if runnerName ~= "" then
        local direct = ReplicatedStorage:FindFirstChild(runnerName)
        if direct then
            return direct
        end

        local uxrFolder = ReplicatedStorage:FindFirstChild("uxrCoder")
        if uxrFolder then
            local nested = uxrFolder:FindFirstChild(runnerName)
            if nested then
                return nested
            end
        end
    end

    return nil
end

local function callHarnessTableFunction(harnessTable, action, payload, context)
    local candidates = { "ExecuteAction", "Execute", "Run", "execute", "run" }
    for _, fnName in ipairs(candidates) do
        local fn = harnessTable[fnName]
        if type(fn) == "function" then
            local ok, response = pcall(function()
                return fn(action, payload, context)
            end)
            if not ok then
                ok, response = pcall(function()
                    return fn(harnessTable, action, payload, context)
                end)
            end
            if ok then
                return true, response
            end
            return false, response
        end
    end

    return false, "Harness module table does not expose ExecuteAction/Execute/Run"
end

local function executeHarnessActionStep(step, context)
    local action = step.action
    if type(action) ~= "string" or action == "" then
        return false, "harnessAction failed: action missing", {
            harnessAction = action
        }
    end

    local payload = {}
    if type(step.payload) == "table" then
        payload = step.payload
    end

    local harness = resolveHarnessInstance(step)
    local journal = context and context.mutationJournal or nil
    if harness then
        if harness:IsA("BindableFunction") then
            local ok, response = pcall(function()
                return harness:Invoke(action, payload, context)
            end)
            if ok then
                local registeredCleanup = journalTrackHarnessCleanupFromResponse(journal, response, "BindableFunction")
                return true, nil, {
                    harnessAction = action,
                    harnessSource = "BindableFunction",
                    harnessInstance = harness:GetFullName(),
                    harnessResponse = serializeForAgentTestPayload(response),
                    registeredCleanup = registeredCleanup,
                }
            end
            return false, "harnessAction bindable invoke failed: " .. tostring(response), {
                harnessAction = action,
                harnessSource = "BindableFunction",
                harnessInstance = harness:GetFullName(),
            }
        elseif harness:IsA("BindableEvent") then
            local ok, err = pcall(function()
                harness:Fire(action, payload, context)
            end)
            if ok then
                return true, nil, {
                    harnessAction = action,
                    harnessSource = "BindableEvent",
                    harnessInstance = harness:GetFullName(),
                }
            end
            return false, "harnessAction bindable fire failed: " .. tostring(err), {
                harnessAction = action,
                harnessSource = "BindableEvent",
                harnessInstance = harness:GetFullName(),
            }
        elseif harness:IsA("ModuleScript") then
            local okRequire, moduleOrErr = pcall(function()
                return require(harness)
            end)
            if not okRequire then
                return false, "harnessAction module require failed: " .. tostring(moduleOrErr), {
                    harnessAction = action,
                    harnessSource = "ModuleScript",
                    harnessInstance = harness:GetFullName(),
                }
            end

            local moduleType = type(moduleOrErr)
            if moduleType == "function" then
                local ok, response = pcall(function()
                    return moduleOrErr(action, payload, context)
                end)
                if ok then
                    local registeredCleanup = journalTrackHarnessCleanupFromResponse(journal, response, "ModuleScriptFunction")
                    return true, nil, {
                        harnessAction = action,
                        harnessSource = "ModuleScriptFunction",
                        harnessInstance = harness:GetFullName(),
                        harnessResponse = serializeForAgentTestPayload(response),
                        registeredCleanup = registeredCleanup,
                    }
                end
                return false, "harnessAction module function failed: " .. tostring(response), {
                    harnessAction = action,
                    harnessSource = "ModuleScriptFunction",
                    harnessInstance = harness:GetFullName(),
                }
            elseif moduleType == "table" then
                local ok, response = callHarnessTableFunction(moduleOrErr, action, payload, context)
                if ok then
                    local registeredCleanup = journalTrackHarnessCleanupFromResponse(journal, response, "ModuleScriptTable")
                    return true, nil, {
                        harnessAction = action,
                        harnessSource = "ModuleScriptTable",
                        harnessInstance = harness:GetFullName(),
                        harnessResponse = serializeForAgentTestPayload(response),
                        registeredCleanup = registeredCleanup,
                    }
                end
                return false, "harnessAction module table failed: " .. tostring(response), {
                    harnessAction = action,
                    harnessSource = "ModuleScriptTable",
                    harnessInstance = harness:GetFullName(),
                }
            end

            return false, "harnessAction module must return table or function", {
                harnessAction = action,
                harnessSource = "ModuleScript",
                harnessInstance = harness:GetFullName(),
            }
        end

        return false, "harnessAction failed: unsupported harness class " .. harness.ClassName, {
            harnessAction = action,
            harnessInstance = harness:GetFullName(),
        }
    end

    if step.allowBuiltin ~= false then
        local ok, err, detail = executeBuiltinHarnessAction(action, payload, step, context)
        if ok then
            return true, nil, detail
        end
        return false, err, detail
    end

    return false, "harnessAction failed: no harness runner found", {
        harnessAction = action
    }
end

local function executeAgentTestStep(runId, index, step, context)
    if type(step) ~= "table" then
        return false, "Step is not an object"
    end

    local stepType = step.type
    if type(stepType) ~= "string" then
        return false, "Step type is missing"
    end

    if context and context.allowDestructiveActions ~= true and isDestructiveTestStepType(stepType) then
        return false, "Step '" .. stepType .. "' blocked by safety.allowDestructiveActions=false", {
            stepType = stepType,
            assertion = false,
        }
    end
    if stepType == "harnessAction" and context and context.allowDestructiveActions ~= true and step.destructive == true then
        return false, "Step 'harnessAction' blocked by safety.allowDestructiveActions=false", {
            stepType = stepType,
            assertion = false,
        }
    end

    if stepType == "log" then
        sendAgentTestEvent(runId, "log", step.message or ("Step " .. tostring(index)))
        return true, nil, {
            stepType = stepType,
            assertion = false,
        }
    elseif stepType == "wait" then
        local waitSeconds = tonumber(step.seconds or step.duration or 0) or 0
        if waitSeconds < 0 then
            waitSeconds = 0
        end

        local maxWait = context and tonumber(context.maxWaitSecondsPerStep) or nil
        if maxWait and waitSeconds > maxWait then
            return false, "wait failed: requested " .. tostring(waitSeconds) .. "s exceeds safety limit " .. tostring(maxWait) .. "s", {
                stepType = stepType,
                assertion = false,
                requestedWaitSeconds = waitSeconds,
                maxWaitSecondsPerStep = maxWait,
            }
        end

        local ok = waitWithAbort(waitSeconds)
        if not ok then
            return false, "Aborted", {
                stepType = stepType,
                assertion = false,
            }
        end
        return true, nil, {
            stepType = stepType,
            assertion = false,
            waitedSeconds = waitSeconds,
        }
    elseif stepType == "assertExists" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            return false, "assertExists failed: target not found", {
                stepType = stepType,
                assertion = true,
                expected = { exists = true },
                actual = { exists = false },
                path = normalizePathInput(step.path),
            }
        end
        return true, nil, {
            stepType = stepType,
            assertion = true,
            expected = { exists = true },
            actual = { exists = true },
            path = normalizePathInput(step.path),
            found = target:GetFullName(),
        }
    elseif stepType == "assertNotExists" then
        local target = resolveInstanceByPath(step.path)
        if target then
            return false, "assertNotExists failed: target exists", {
                stepType = stepType,
                assertion = true,
                expected = { exists = false },
                actual = { exists = true },
                path = normalizePathInput(step.path),
                found = target:GetFullName(),
            }
        end
        return true, nil, {
            stepType = stepType,
            assertion = true,
            expected = { exists = false },
            actual = { exists = false },
            path = normalizePathInput(step.path),
        }
    elseif stepType == "assertProperty" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            return false, "assertProperty failed: target not found", {
                stepType = stepType,
                assertion = true,
                expected = { propertyExists = true },
                actual = { propertyExists = false },
                path = normalizePathInput(step.path),
            }
        end

        local propertyName = step.property
        if type(propertyName) ~= "string" or propertyName == "" then
            return false, "assertProperty failed: property missing", {
                stepType = stepType,
                assertion = true,
            }
        end

        local expected = deserializeValue(step.equals)
        local success, actual = pcall(function()
            return target[propertyName]
        end)
        if not success then
            return false, "assertProperty failed: cannot read property '" .. propertyName .. "'", {
                stepType = stepType,
                assertion = true,
                property = propertyName,
                expected = serializeForAgentTestPayload(expected),
                actual = "<read_failed>",
                path = normalizePathInput(step.path),
            }
        end

        if not valuesEqualForTest(actual, expected) then
            return false, "assertProperty mismatch on '" .. propertyName .. "' (expected " .. tostring(expected) .. ", actual " .. tostring(actual) .. ")", {
                stepType = stepType,
                assertion = true,
                property = propertyName,
                expected = serializeForAgentTestPayload(expected),
                actual = serializeForAgentTestPayload(actual),
                path = normalizePathInput(step.path),
            }
        end

        return true, nil, {
            stepType = stepType,
            assertion = true,
            property = propertyName,
            expected = serializeForAgentTestPayload(expected),
            actual = serializeForAgentTestPayload(actual),
            path = normalizePathInput(step.path),
        }
    elseif stepType == "assertCharacterReady" then
        local character, humanoid, root, rigErr = resolvePlayableCharacterRig()
        if rigErr then
            return false, "assertCharacterReady failed: " .. tostring(rigErr), {
                stepType = stepType,
                assertion = true,
                expected = { characterReady = true },
                actual = { characterReady = false },
            }
        end

        return true, nil, {
            stepType = stepType,
            assertion = true,
            expected = { characterReady = true },
            actual = { characterReady = true },
            character = character:GetFullName(),
            humanoid = humanoid:GetFullName(),
            root = root:GetFullName(),
        }
    elseif stepType == "assertCharacterNearPath" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            return false, "assertCharacterNearPath failed: target not found", {
                stepType = stepType,
                assertion = true,
                path = normalizePathInput(step.path),
                expected = { targetExists = true },
                actual = { targetExists = false },
            }
        end

        local targetCFrame = resolveTeleportCFrame(target)
        if not targetCFrame then
            return false, "assertCharacterNearPath failed: target has no position", {
                stepType = stepType,
                assertion = true,
                target = target:GetFullName(),
            }
        end

        local character, _, root, rigErr = resolvePlayableCharacterRig()
        if rigErr then
            return false, "assertCharacterNearPath failed: " .. tostring(rigErr), {
                stepType = stepType,
                assertion = true,
                target = target:GetFullName(),
                expected = { characterReady = true },
                actual = { characterReady = false },
            }
        end

        local tolerance = tonumber(step.maxDistance or step.tolerance or 4) or 4
        if tolerance < 0 then
            tolerance = 0
        end
        local distance = (root.Position - targetCFrame.Position).Magnitude
        if distance > tolerance then
            return false, "assertCharacterNearPath failed: distance " .. tostring(distance) .. " > " .. tostring(tolerance), {
                stepType = stepType,
                assertion = true,
                target = target:GetFullName(),
                character = character:GetFullName(),
                expected = {
                    maxDistance = tolerance,
                },
                actual = {
                    distance = distance,
                },
            }
        end

        return true, nil, {
            stepType = stepType,
            assertion = true,
            target = target:GetFullName(),
            character = character:GetFullName(),
            expected = {
                maxDistance = tolerance,
            },
            actual = {
                distance = distance,
            },
        }
    elseif stepType == "assertHumanoidState" then
        local expectedStates = collectExpectedStateNames(step)
        if #expectedStates == 0 then
            return false, "assertHumanoidState failed: state/anyOf missing", {
                stepType = stepType,
                assertion = true,
            }
        end

        local character, humanoid, _, rigErr = resolvePlayableCharacterRig()
        if rigErr then
            return false, "assertHumanoidState failed: " .. tostring(rigErr), {
                stepType = stepType,
                assertion = true,
                expected = {
                    states = expectedStates,
                },
                actual = {
                    state = "<unavailable>",
                },
            }
        end

        local stateOk, stateOrErr = pcall(function()
            return humanoid:GetState()
        end)
        if not stateOk or not stateOrErr then
            return false, "assertHumanoidState failed: cannot read humanoid state", {
                stepType = stepType,
                assertion = true,
                expected = {
                    states = expectedStates,
                },
                actual = {
                    state = "<read_failed>",
                },
            }
        end

        local actualState = stateOrErr.Name
        local actualNormalized = string.lower(actualState)
        local matched = false
        for _, candidate in ipairs(expectedStates) do
            if string.lower(candidate) == actualNormalized then
                matched = true
                break
            end
        end

        if not matched then
            return false, "assertHumanoidState failed: expected one of [" .. table.concat(expectedStates, ", ") .. "], got " .. tostring(actualState), {
                stepType = stepType,
                assertion = true,
                character = character:GetFullName(),
                expected = {
                    states = expectedStates,
                },
                actual = {
                    state = actualState,
                },
            }
        end

        return true, nil, {
            stepType = stepType,
            assertion = true,
            character = character:GetFullName(),
            expected = {
                states = expectedStates,
            },
            actual = {
                state = actualState,
            },
        }
    elseif stepType == "assertHumanoidWalkSpeed" then
        local expectedSpeed = tonumber(step.equals or step.speed or step.value)
        if not expectedSpeed then
            return false, "assertHumanoidWalkSpeed failed: expected speed missing", {
                stepType = stepType,
                assertion = true,
            }
        end

        local tolerance = tonumber(step.tolerance or 0) or 0
        if tolerance < 0 then
            tolerance = 0
        end

        local character, humanoid, _, rigErr = resolvePlayableCharacterRig()
        if rigErr then
            return false, "assertHumanoidWalkSpeed failed: " .. tostring(rigErr), {
                stepType = stepType,
                assertion = true,
                expected = { walkSpeed = expectedSpeed, tolerance = tolerance },
                actual = { walkSpeed = "<unavailable>" },
            }
        end

        local actualSpeed = tonumber(humanoid.WalkSpeed) or 0
        local delta = math.abs(actualSpeed - expectedSpeed)
        if delta > tolerance then
            return false, "assertHumanoidWalkSpeed failed: expected " .. tostring(expectedSpeed) .. "±" .. tostring(tolerance) .. ", got " .. tostring(actualSpeed), {
                stepType = stepType,
                assertion = true,
                character = character:GetFullName(),
                expected = { walkSpeed = expectedSpeed, tolerance = tolerance },
                actual = { walkSpeed = actualSpeed, delta = delta },
            }
        end

        return true, nil, {
            stepType = stepType,
            assertion = true,
            character = character:GetFullName(),
            expected = { walkSpeed = expectedSpeed, tolerance = tolerance },
            actual = { walkSpeed = actualSpeed, delta = delta },
        }
    elseif stepType == "setProperty" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            return false, "setProperty failed: target not found", {
                stepType = stepType,
                assertion = false,
                path = normalizePathInput(step.path),
            }
        end

        local propertyName = step.property
        if type(propertyName) ~= "string" or propertyName == "" then
            return false, "setProperty failed: property missing", {
                stepType = stepType,
                assertion = false,
                path = normalizePathInput(step.path),
            }
        end

        local value = deserializeValue(step.value)
        local journal = context and context.mutationJournal or nil
        journalCaptureProperty(journal, target, propertyName)

        local success, err = runWithSuppressedSync(function()
            target[propertyName] = value
        end, context and context.suppressSyncChanges == true)
        if not success then
            return false, "setProperty failed: " .. tostring(err), {
                stepType = stepType,
                assertion = false,
                property = propertyName,
                value = serializeForAgentTestPayload(value),
                path = normalizePathInput(step.path),
            }
        end

        return true, nil, {
            stepType = stepType,
            assertion = false,
            property = propertyName,
            value = serializeForAgentTestPayload(value),
            path = normalizePathInput(step.path),
        }
    elseif stepType == "createInstance" then
        local className = step.className
        if type(className) ~= "string" or className == "" then
            return false, "createInstance failed: className missing", {
                stepType = stepType,
                assertion = false,
            }
        end

        local parentPath, name = splitTargetPathForCreation(step)
        if #parentPath == 0 then
            return false, "createInstance failed: parent path missing", {
                stepType = stepType,
                assertion = false,
            }
        end

        if type(name) ~= "string" or name == "" then
            return false, "createInstance failed: name missing", {
                stepType = stepType,
                assertion = false,
            }
        end

        local parent = resolveInstanceByPath(parentPath)
        if not parent then
            return false, "createInstance failed: parent not found", {
                stepType = stepType,
                assertion = false,
                parentPath = parentPath,
            }
        end

        if step.allowDuplicateName ~= true then
            local existing = parent:FindFirstChild(name)
            if existing then
                return false, "createInstance failed: name already exists under parent", {
                    stepType = stepType,
                    assertion = false,
                    parentPath = parentPath,
                    name = name,
                    existing = existing:GetFullName(),
                }
            end
        end

        local created = nil
        local success, err = runWithSuppressedSync(function()
            created = Instance.new(className)
            created.Name = name
            applyPropertiesToTestInstance(created, step.properties)
            created.Parent = parent
        end, context and context.suppressSyncChanges == true)
        if not success then
            return false, "createInstance failed: " .. tostring(err), {
                stepType = stepType,
                assertion = false,
                parentPath = parentPath,
                name = name,
            }
        end

        journalTrackCreatedInstance(context and context.mutationJournal or nil, created)
        return true, nil, {
            stepType = stepType,
            assertion = false,
            createdPath = parentPath,
            name = name,
            className = className,
        }
    elseif stepType == "destroyInstance" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            if step.ignoreMissing == true then
                return true, nil, {
                    stepType = stepType,
                    assertion = false,
                    ignoredMissing = true,
                    path = normalizePathInput(step.path),
                }
            end
            return false, "destroyInstance failed: target not found", {
                stepType = stepType,
                assertion = false,
                path = normalizePathInput(step.path),
            }
        end

        local targetName = target:GetFullName()
        journalTrackDestroyedInstance(context and context.mutationJournal or nil, target)

        local success, err = runWithSuppressedSync(function()
            target:Destroy()
        end, context and context.suppressSyncChanges == true)
        if not success then
            return false, "destroyInstance failed: " .. tostring(err), {
                stepType = stepType,
                assertion = false,
                target = targetName,
            }
        end

        return true, nil, {
            stepType = stepType,
            assertion = false,
            target = targetName,
        }
    elseif stepType == "renameInstance" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            return false, "renameInstance failed: target not found", {
                stepType = stepType,
                assertion = false,
                path = normalizePathInput(step.path),
            }
        end

        local newName = step.name or step.newName
        if type(newName) ~= "string" or newName == "" then
            return false, "renameInstance failed: new name missing", {
                stepType = stepType,
                assertion = false,
            }
        end

        local oldName = target:GetFullName()
        journalCaptureProperty(context and context.mutationJournal or nil, target, "Name")

        local success, err = runWithSuppressedSync(function()
            target.Name = newName
        end, context and context.suppressSyncChanges == true)
        if not success then
            return false, "renameInstance failed: " .. tostring(err), {
                stepType = stepType,
                assertion = false,
                target = oldName,
                newName = newName,
            }
        end

        return true, nil, {
            stepType = stepType,
            assertion = false,
            target = oldName,
            newName = newName,
            resolved = target:GetFullName(),
        }
    elseif stepType == "reparentInstance" then
        local target = resolveInstanceByPath(step.path)
        if not target then
            return false, "reparentInstance failed: target not found", {
                stepType = stepType,
                assertion = false,
                path = normalizePathInput(step.path),
            }
        end

        local newParent = resolveInstanceByPath(step.newParentPath or step.parentPath)
        if not newParent then
            return false, "reparentInstance failed: new parent not found", {
                stepType = stepType,
                assertion = false,
                newParentPath = normalizePathInput(step.newParentPath or step.parentPath),
            }
        end

        local fromPath = target:GetFullName()
        journalCaptureProperty(context and context.mutationJournal or nil, target, "Parent")
        if type(step.newName) == "string" and step.newName ~= "" then
            journalCaptureProperty(context and context.mutationJournal or nil, target, "Name")
        end

        local success, err = runWithSuppressedSync(function()
            target.Parent = newParent
            local newName = step.newName
            if type(newName) == "string" and newName ~= "" then
                target.Name = newName
            end
        end, context and context.suppressSyncChanges == true)
        if not success then
            return false, "reparentInstance failed: " .. tostring(err), {
                stepType = stepType,
                assertion = false,
                from = fromPath,
                toParent = newParent:GetFullName(),
            }
        end

        return true, nil, {
            stepType = stepType,
            assertion = false,
            from = fromPath,
            toParent = newParent:GetFullName(),
            resolved = target:GetFullName(),
        }
    elseif stepType == "harnessAction" then
        local harnessContext = {
            runId = context and context.runId or nil,
            stepIndex = index,
            scenarioName = context and context.scenarioName or nil,
            mutationJournal = context and context.mutationJournal or nil,
            suppressSyncChanges = context and context.suppressSyncChanges == true,
        }
        local ok, err, detail = executeHarnessActionStep(step, harnessContext)
        if ok then
            return true, nil, detail
        end
        return false, err, detail
    elseif stepType == "captureScreenshot" then
        local screenshotName = step.name or ("screenshot-step-" .. tostring(index))
        local width, height = normalizeScreenshotDimensions(step.width, step.height)
        local captureOk, captureResult, captureErr = attemptScreenshotCapture(width, height)
        local mimeType, base64Data, parseDetail = extractImagePayloadFromCaptureResult(captureResult)
        local baselineKey, baselineMode, baselineAllowMissing = resolveScreenshotBaselineOptions(step, screenshotName)

        if mimeType and base64Data then
            local captureResultPayload = {
                step = index,
                stepType = stepType,
                width = width,
                height = height,
                mimeType = mimeType,
            }
            if baselineKey then
                captureResultPayload.baselineKey = baselineKey
                captureResultPayload.baselineMode = baselineMode
                captureResultPayload.baselineAllowMissing = baselineAllowMissing
            end
            sendAgentTestBinaryArtifact(
                runId,
                screenshotName,
                mimeType,
                base64Data,
                "Captured screenshot: " .. tostring(screenshotName),
                captureResultPayload
            )

            local detail = {
                stepType = stepType,
                assertion = false,
                artifactName = screenshotName,
                mimeType = mimeType,
                width = width,
                height = height,
            }
            if baselineKey then
                detail.baselineKey = baselineKey
                detail.baselineMode = baselineMode
                detail.baselineAllowMissing = baselineAllowMissing
            end
            return true, nil, detail
        end

        local fallbackArtifact = {
            type = "captureScreenshot",
            step = index,
            width = width,
            height = height,
            captureOk = captureOk,
            captureError = captureErr,
        }
        if parseDetail and parseDetail.rawResult ~= nil then
            fallbackArtifact.rawResult = parseDetail.rawResult
        elseif captureResult ~= nil then
            fallbackArtifact.rawResult = serializeForAgentTestPayload(captureResult)
        end
        sendAgentTestArtifact(
            runId,
            screenshotName,
            fallbackArtifact,
            "Screenshot capture fallback artifact: " .. tostring(screenshotName),
            {
                step = index,
                stepType = stepType,
                captureOk = captureOk,
                captureError = captureErr,
                baselineKey = baselineKey,
                baselineMode = baselineMode,
                baselineAllowMissing = baselineAllowMissing,
            }
        )

        local detail = {
            stepType = stepType,
            assertion = false,
            artifactName = screenshotName,
            width = width,
            height = height,
            captureOk = captureOk,
            captureError = captureErr,
        }
        if baselineKey then
            detail.baselineKey = baselineKey
            detail.baselineMode = baselineMode
            detail.baselineAllowMissing = baselineAllowMissing
        end
        if step.required == true then
            return false, "captureScreenshot failed: " .. tostring(captureErr or "No image payload returned"), detail
        end
        return true, nil, detail
    elseif stepType == "captureArtifact" then
        local artifactName = step.name or ("capture-step-" .. tostring(index))
        local artifactPayload = {
            step = index,
            type = "captureArtifact",
            capturedAt = os.time(),
        }

        if step.path ~= nil then
            local target = resolveInstanceByPath(step.path)
            if not target then
                return false, "captureArtifact failed: target not found", {
                    stepType = stepType,
                    assertion = false,
                    path = normalizePathInput(step.path),
                }
            end

            artifactPayload.path = normalizePathInput(step.path)
            artifactPayload.target = target:GetFullName()
            artifactPayload.className = target.ClassName

            local capturedProps = {}
            local properties = step.properties
            if type(properties) == "table" and #properties > 0 then
                for _, propertyName in ipairs(properties) do
                    if type(propertyName) == "string" and propertyName ~= "" then
                        local readOk, readValue = pcall(function()
                            return target[propertyName]
                        end)
                        capturedProps[propertyName] = readOk
                            and serializeForAgentTestPayload(readValue)
                            or "<read_failed>"
                    end
                end
            else
                capturedProps.Name = target.Name
                if target:IsA("BasePart") then
                    capturedProps.Position = serializeVector3(target.Position)
                    capturedProps.CFrame = serializeCFrame(target.CFrame)
                end
            end
            artifactPayload.properties = capturedProps
        else
            artifactPayload.value = serializeForAgentTestPayload(step.value)
        end

        sendAgentTestArtifact(
            runId,
            artifactName,
            artifactPayload,
            "Captured artifact: " .. tostring(artifactName),
            {
                step = index,
                stepType = stepType,
            }
        )

        return true, nil, {
            stepType = stepType,
            assertion = false,
            artifactName = artifactName,
        }
    end

    return false, "Unknown step type: " .. tostring(stepType), {
        stepType = stepType,
        assertion = false,
    }
end

local function mergeStepDetail(stepResult, detail)
    if type(detail) ~= "table" then
        return
    end

    for key, value in pairs(detail) do
        stepResult[tostring(key)] = serializeForAgentTestPayload(value)
    end
end

local function buildRunSummaryArtifact(scenarioName, runtimeInfo, metrics, finalStatus, failureMessage)
    local artifact = {
        schema = "uxr-agent-test-summary/v1",
        scenarioName = scenarioName,
        finalStatus = finalStatus,
        failureMessage = failureMessage,
        runtime = serializeForAgentTestPayload(runtimeInfo),
        metrics = {
            totalSteps = metrics.totalSteps,
            stepsExecuted = metrics.stepsExecuted,
            assertionsPassed = metrics.assertionsPassed,
            assertionsFailed = metrics.assertionsFailed,
            durationMs = metrics.durationMs,
        },
        steps = metrics.stepResults,
    }
    return artifact
end

local function executeAgentTestRun(runId, payload)
    if currentAgentTestRunId then
        sendAgentTestEvent(runId, "error", "Another test is already running", {
            activeRunId = currentAgentTestRunId
        })
        return
    end

    currentAgentTestRunId = runId
    currentAgentTestAbortRequested = false
    local requestedAttempt = payload and tonumber(payload.attempt) or nil
    if type(requestedAttempt) == "number" and requestedAttempt >= 1 then
        currentAgentTestAttempt = math.floor(requestedAttempt)
    else
        currentAgentTestAttempt = nil
    end
    sendAgentTestEvent(runId, "started", "Test run started")

    local runtimeCleanup = function() end
    local runtimeInfo = {
        requestedMode = "none",
        started = false,
        startSource = nil,
        startError = nil,
    }
    local mutationJournal = nil
    local scenarioName = "unnamed-scenario"
    local summaryMetrics = {
        totalSteps = 0,
        stepsExecuted = 0,
        assertionsPassed = 0,
        assertionsFailed = 0,
        durationMs = 0,
        stepResults = {},
    }
    local finalOutcome = nil

    local success, err = xpcall(function()
        local scenario = payload and payload.scenario or {}
        local steps = scenario.steps
        if type(steps) ~= "table" then
            error("Scenario must include steps array")
        end

        scenarioName = type(scenario.name) == "string" and scenario.name or "unnamed-scenario"

        local safety = scenario.safety
        if type(safety) ~= "table" then
            safety = {}
        end

        mutationJournal = createAgentTestMutationJournal(scenario.isolation)
        local stepContext = {
            runId = runId,
            scenarioName = scenarioName,
            allowDestructiveActions = safety.allowDestructiveActions == true,
            maxWaitSecondsPerStep = tonumber(safety.maxWaitSecondsPerStep) or 30,
            mutationJournal = mutationJournal,
            suppressSyncChanges = mutationJournal.suppressSyncChanges == true,
        }

        runtimeCleanup, runtimeInfo = beginAgentRuntimeSession(runId, scenario, stepContext.suppressSyncChanges)
        sendAgentTestEvent(runId, "log", "Safety policy: allowDestructiveActions=" .. tostring(stepContext.allowDestructiveActions)
            .. ", maxWaitSecondsPerStep=" .. tostring(stepContext.maxWaitSecondsPerStep)
            .. ", isolationEnabled=" .. tostring(mutationJournal.enabled == true)
            .. ", suppressSyncChanges=" .. tostring(stepContext.suppressSyncChanges)
            .. ", cleanupCreatedInstances=" .. tostring(mutationJournal.cleanupCreatedInstances == true)
            .. ", restoreDestroyedInstances=" .. tostring(mutationJournal.restoreDestroyedInstances == true)
            .. ", restorePropertyChanges=" .. tostring(mutationJournal.restorePropertyChanges == true))

        local startedAt = os.clock()
        local metrics = {
            totalSteps = #steps,
            stepsExecuted = 0,
            assertionsPassed = 0,
            assertionsFailed = 0,
            durationMs = 0,
            stepResults = {},
        }
        summaryMetrics = metrics

        for index, step in ipairs(steps) do
            if currentAgentTestAbortRequested then
                local durationMs = math.floor((os.clock() - startedAt) * 1000)
                metrics.durationMs = durationMs
                local abortResult = {
                    step = index,
                    stepType = step.type,
                    stepsExecuted = metrics.stepsExecuted,
                    totalSteps = metrics.totalSteps,
                    assertionsPassed = metrics.assertionsPassed,
                    assertionsFailed = metrics.assertionsFailed,
                    durationMs = durationMs,
                    runtime = serializeForAgentTestPayload(runtimeInfo),
                }
                finalOutcome = {
                    status = "aborted",
                    message = "Abort requested",
                    failureMessage = "Abort requested",
                    result = abortResult,
                }
                return
            end

            local stepStartedAt = os.clock()
            local stepOk, stepErr, stepDetail = executeAgentTestStep(runId, index, step, stepContext)
            local stepDurationMs = math.floor((os.clock() - stepStartedAt) * 1000)

            local stepResult = {
                index = index,
                stepType = type(step.type) == "string" and step.type or "<unknown>",
                ok = stepOk,
                durationMs = stepDurationMs,
            }
            mergeStepDetail(stepResult, stepDetail)
            table.insert(metrics.stepResults, stepResult)

            if stepResult.assertion == true then
                if stepOk then
                    metrics.assertionsPassed = metrics.assertionsPassed + 1
                else
                    metrics.assertionsFailed = metrics.assertionsFailed + 1
                end
            end

            if not stepOk then
                local durationMs = math.floor((os.clock() - startedAt) * 1000)
                metrics.durationMs = durationMs

                local baseFailureResult = {
                    step = index,
                    stepType = stepResult.stepType,
                    stepsExecuted = metrics.stepsExecuted,
                    totalSteps = metrics.totalSteps,
                    assertionsPassed = metrics.assertionsPassed,
                    assertionsFailed = metrics.assertionsFailed,
                    durationMs = durationMs,
                    runtime = serializeForAgentTestPayload(runtimeInfo),
                    stepResult = stepResult,
                }
                if stepErr == "Aborted" then
                    finalOutcome = {
                        status = "aborted",
                        message = "Abort requested",
                        failureMessage = "Abort requested",
                        result = baseFailureResult,
                    }
                else
                    finalOutcome = {
                        status = "failed",
                        message = stepErr,
                        failureMessage = stepErr,
                        result = baseFailureResult,
                    }
                end
                return
            end

            metrics.stepsExecuted = metrics.stepsExecuted + 1
        end

        local durationMs = math.floor((os.clock() - startedAt) * 1000)
        metrics.durationMs = durationMs

        local passResult = {
            stepsExecuted = metrics.stepsExecuted,
            totalSteps = metrics.totalSteps,
            assertionsPassed = metrics.assertionsPassed,
            assertionsFailed = metrics.assertionsFailed,
            durationMs = durationMs,
            runtime = serializeForAgentTestPayload(runtimeInfo),
        }
        finalOutcome = {
            status = "passed",
            message = "Scenario completed",
            failureMessage = nil,
            result = passResult,
        }
    end, debug.traceback)

    pcall(runtimeCleanup)
    local isolationSummary = applyAgentTestMutationCleanup(runId, mutationJournal)
    runtimeInfo.isolation = isolationSummary

    if not success then
        finalOutcome = {
            status = "error",
            message = tostring(err),
            failureMessage = tostring(err),
            result = {
                runtime = serializeForAgentTestPayload(runtimeInfo)
            },
        }
    end

    if not finalOutcome then
        finalOutcome = {
            status = "error",
            message = "Test run ended without final outcome",
            failureMessage = "Test run ended without final outcome",
            result = {
                runtime = serializeForAgentTestPayload(runtimeInfo)
            },
        }
    end

    if finalOutcome.status == "passed"
        and type(isolationSummary) == "table"
        and (tonumber(isolationSummary.failures) or 0) > 0
    then
        local failureCount = tonumber(isolationSummary.failures) or 0
        local cleanupFailureMessage = "Isolation cleanup reported " .. tostring(failureCount) .. " failure(s)"
        finalOutcome.status = "failed"
        finalOutcome.message = cleanupFailureMessage
        finalOutcome.failureMessage = cleanupFailureMessage
        if type(finalOutcome.result) ~= "table" then
            finalOutcome.result = {}
        end
        finalOutcome.result.reason = "isolation_cleanup_failed"
        finalOutcome.result.isolationFailures = failureCount
    end

    if type(finalOutcome.result) ~= "table" then
        finalOutcome.result = {}
    end
    finalOutcome.result.runtime = serializeForAgentTestPayload(runtimeInfo)

    sendAgentTestArtifact(
        runId,
        "run-summary",
        buildRunSummaryArtifact(scenarioName, runtimeInfo, summaryMetrics, finalOutcome.status, finalOutcome.failureMessage),
        "Run summary artifact",
        finalOutcome.result
    )
    sendAgentTestEvent(runId, finalOutcome.status, finalOutcome.message, finalOutcome.result)

    if not success then
        logError("Agent test run failed:", tostring(err))
    end

    currentAgentTestRunId = nil
    currentAgentTestAbortRequested = false
    currentAgentTestAttempt = nil
end

--- Apply a change received from the external editor.
--- @param change table The change to apply
local function applyChange(change)
    isApplyingServerChange = true
    ChangeHistoryService:SetWaypoint("uxrCoder: Before change")

    local function finalizeApply()
        ChangeHistoryService:SetWaypoint("uxrCoder: Transaction committed")
        -- Delay clearing the flag to let DescendantAdded/Removing events settle
        task.delay(0.1, function()
            isApplyingServerChange = false
        end)
    end

    local path = change.path or {}
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
            finalizeApply()
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
        elseif change.action == "test_run" then
             local runId = change.runId
             if type(runId) ~= "string" or runId == "" then
                 logError("Command 'test_run' missing runId")
             elseif currentAgentTestRunId and currentAgentTestRunId ~= runId then
                 sendAgentTestEvent(runId, "error", "Another test is already running", {
                     activeRunId = currentAgentTestRunId
                 })
             else
                 task.spawn(function()
                     executeAgentTestRun(runId, change.payload)
                 end)
             end
        elseif change.action == "test_abort" then
             local runId = change.runId
             if currentAgentTestRunId and (type(runId) ~= "string" or runId == "" or runId == currentAgentTestRunId) then
                 currentAgentTestAbortRequested = true
                 sendAgentTestEvent(currentAgentTestRunId, "log", "Abort signal received")
             end
        end

    elseif change.type == "reparent" and target then
        local newParentPath = change.newParentPath
        local newParent = game
        
        -- Navigate to new parent
        for i, name in ipairs(newParentPath) do
            if i == 1 then
                local success, service = pcall(function() return game:GetService(name) end)
                if success then
                    newParent = service
                else
                    newParent = game:FindFirstChild(name)
                end
            else
                newParent = newParent and newParent:FindFirstChild(name)
            end
            
            if not newParent then
                 logError("Reparent failed: New parent not found:", table.concat(newParentPath, "."))
                 finalizeApply()
                 return
            end
        end
        
        local success, err = pcall(function()
            target.Parent = newParent
            if type(change.newName) == "string" and change.newName ~= "" and target.Name ~= change.newName then
                target.Name = change.newName
            end
        end)
        
        if success then
            log("Reparented:", target.Name, "to", newParent.Name)
        else
            logError("Failed to reparent:", err)
        end
    end

    finalizeApply()
end

-- =============================================================================
-- Sync Loop
-- =============================================================================

--- Perform a sync cycle with the server.
-- =============================================================================
-- Change Tracking & Batching
-- =============================================================================

--- Build a stable key for change coalescing.
--- @param change table
--- @return string
local function buildChangeKey(change)
    local pathStr = table.concat(change.path or {}, ".")
    local propertyName = ""

    if change.type == "update" and change.property then
        propertyName = ":" .. tostring(change.property.name)
    end

    return tostring(change.type) .. ":" .. pathStr .. propertyName
end

--- Enqueue or replace a pending change by key (latest value wins).
--- @param change table
local function enqueuePendingChange(change)
    local key = buildChangeKey(change)
    local existingIndex = pendingChangesMap[key]

    if existingIndex then
        pendingChanges[existingIndex] = change
    else
        table.insert(pendingChanges, change)
        pendingChangesMap[key] = #pendingChanges
    end
end

--- Rebuild pending change index map.
local function rebuildPendingChangeMap()
    pendingChangesMap = {}
    for i, change in ipairs(pendingChanges) do
        pendingChangesMap[buildChangeKey(change)] = i
    end
end

--- Queue a change to be sent to the server.
--- @param changeType string "create" | "update" | "delete"
--- @param instance Instance The instance involved
--- @param property string|nil The property name (for updates)
local function queueChange(changeType, instance, property)
    if not CONFIG.ENABLED then return end
    if not isInitialSyncComplete then return end
    if isApplyingServerChange then return end
    if isApplyingAgentTestIsolationChange then return end
    
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
        -- DescendantAdded already fires for descendants, so keep creates shallow.
        change.instance = serializeInstance(instance, false)
    elseif changeType == "update" then
        if not property then return end
        local serializeSuccess, serializedValue = serializeProperty(instance, property, false)
        if not serializeSuccess then
            return
        end

        change.property = {
            name = property,
            value = serializedValue
        }
    elseif changeType == "delete" then
        -- Path is enough for delete
    end

    enqueuePendingChange(change)
end

--- Ensure sibling names stay unique for deterministic sync paths.
--- @return boolean renamed
local function enforceUniqueSiblingName(instance)
    if not instance or not instance.Parent or instance.Parent == game then
        return false
    end

    local parent = instance.Parent
    local desiredName = instance.Name

    local function siblingNameExists(candidate)
        for _, sibling in ipairs(parent:GetChildren()) do
            if sibling ~= instance and sibling.Name == candidate then
                return true
            end
        end
        return false
    end

    if not siblingNameExists(desiredName) then
        return false
    end

    local baseName = desiredName
    local startSuffix = 2

    while true do
        local candidateBase, parsedSuffix = string.match(baseName, "^(.*)_(%d+)$")
        local parsedNumber = tonumber(parsedSuffix)
        if not candidateBase or candidateBase == "" or not parsedNumber or parsedNumber < 2 then
            break
        end
        if not siblingNameExists(candidateBase) then
            break
        end

        baseName = candidateBase
        if parsedNumber + 1 > startSuffix then
            startSuffix = parsedNumber + 1
        end
    end

    local suffix = startSuffix
    local uniqueName = baseName .. "_" .. tostring(suffix)
    while siblingNameExists(uniqueName) do
        suffix = suffix + 1
        uniqueName = baseName .. "_" .. tostring(suffix)
    end

    local renameSuccess = pcall(function()
        instance.Name = uniqueName
    end)

    if renameSuccess then
        log("Auto-resolved sibling collision:", baseName, "->", uniqueName)
        return true
    end

    return false
end

--- Track an instance's changes.
--- @param instance Instance The instance to track
local function trackInstance(instance)
    if trackedConnections[instance] then return end
    
    local connections = {}
    
    -- Track property changes
    table.insert(connections, instance.Changed:Connect(function(property)
        if property == "Name" and not isApplyingServerChange then
            if enforceUniqueSiblingName(instance) then
                return
            end
        end

        if isPropertySyncable(instance, property) then
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
    if serviceConnections[service] then
        return
    end

    -- Track existing descendants
    for _, descendant in ipairs(service:GetDescendants()) do
        trackInstance(descendant)
    end
    trackInstance(service)
    
    -- Listen for new descendants
    local addConn = service.DescendantAdded:Connect(function(descendant)
        if not isApplyingServerChange then
            enforceUniqueSiblingName(descendant)
        end
        trackInstance(descendant)
        queueChange("create", descendant)
    end)
    
    -- Listen for removed descendants
    local removeConn = service.DescendantRemoving:Connect(function(descendant)
        untrackInstance(descendant)
        queueChange("delete", descendant)
    end)

    serviceConnections[service] = { addConn, removeConn }
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
        -- Move current queue out so new changes can be collected while request is in flight
        pendingChanges = {}
        pendingChangesMap = {}
        
        local success, response = request("POST", "/sync/delta", { changes = batch })
        
        if success then
            log("Synced", #batch, "changes")
            errorCount = 0
        else
            -- Merge failed batch back with any new queued changes (newer values win per key).
            local newQueue = pendingChanges
            pendingChanges = {}
            pendingChangesMap = {}
            for _, failedChange in ipairs(batch) do
                enqueuePendingChange(failedChange)
            end
            for _, newChange in ipairs(newQueue) do
                enqueuePendingChange(newChange)
            end
            rebuildPendingChangeMap()
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
task.spawn(function()
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

    for instance, connections in pairs(trackedConnections) do
        for _, conn in ipairs(connections) do
            conn:Disconnect()
        end
        trackedConnections[instance] = nil
    end

    for service, connections in pairs(serviceConnections) do
        for _, conn in ipairs(connections) do
            conn:Disconnect()
        end
        serviceConnections[service] = nil
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
