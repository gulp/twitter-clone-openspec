--[[
  Atomic SSE event publishing script.

  This script atomically:
  1. INCR sequence number
  2. Add seq to event JSON
  3. PUBLISH event to Pub/Sub channel (with seq)
  4. LPUSH event to replay buffer (with seq)
  5. LTRIM replay buffer to max 200 entries
  6. EXPIRE replay buffer to 5 minutes

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

-- Step 1: INCR sequence number FIRST
local seq = redis.call('INCR', seqKey)

-- Step 2: Build event with sequence number
-- Parse the event JSON, add seq field, and re-serialize
local event = cjson.decode(eventJson)
event.seq = seq
local eventWithSeq = cjson.encode(event)

-- Step 3: PUBLISH to Pub/Sub channel (WITH seq)
redis.call('PUBLISH', channel, eventWithSeq)

-- Step 4: LPUSH to replay buffer (same event with seq)
redis.call('LPUSH', replayKey, eventWithSeq)

-- Step 5: LTRIM to max 200 entries (0-indexed, 0 to 199 inclusive)
redis.call('LTRIM', replayKey, 0, 199)

-- Step 6: EXPIRE replay buffer to 300 seconds (5 minutes)
redis.call('EXPIRE', replayKey, 300)

-- Return the sequence number
return seq
