--[[
  Atomic SSE event publishing script.

  This script atomically:
  1. PUBLISH event to Pub/Sub channel
  2. INCR sequence number
  3. LPUSH event to replay buffer with sequence
  4. LTRIM replay buffer to max 200 entries
  5. EXPIRE replay buffer to 5 minutes

  Arguments:
    KEYS[1] - Pub/Sub channel (e.g., "sse:user:{userId}")
    KEYS[2] - Sequence key (e.g., "sse:seq:{userId}")
    KEYS[3] - Replay buffer key (e.g., "sse:replay:{userId}")
    ARGV[1] - Event data as JSON string: {"type": "...", "data": {...}}

  Returns:
    Sequence number (integer)
]]

local channel = KEYS[1]
local seqKey = KEYS[2]
local replayKey = KEYS[3]
local eventJson = ARGV[1]

-- Step 1: PUBLISH to Pub/Sub channel
redis.call('PUBLISH', channel, eventJson)

-- Step 2: INCR sequence number
local seq = redis.call('INCR', seqKey)

-- Step 3: Build replay entry with sequence number
-- Parse the event JSON, add seq field, and re-serialize
local event = cjson.decode(eventJson)
event.seq = seq
local replayEntry = cjson.encode(event)

-- Step 4: LPUSH to replay buffer
redis.call('LPUSH', replayKey, replayEntry)

-- Step 5: LTRIM to max 200 entries (0-indexed, 0 to 199 inclusive)
redis.call('LTRIM', replayKey, 0, 199)

-- Step 6: EXPIRE replay buffer to 300 seconds (5 minutes)
redis.call('EXPIRE', replayKey, 300)

-- Return the sequence number
return seq
