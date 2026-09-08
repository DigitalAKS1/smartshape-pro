"""
Redis cache wrapper for CRM performance optimization.
Handles all caching operations with automatic TTL and fallback to no-cache on error.
"""
import redis
import json
import os
from typing import Any, Optional

# Initialize Redis client
redis_client = redis.Redis(
    host=os.environ.get("REDIS_HOST", "localhost"),
    port=int(os.environ.get("REDIS_PORT", 6379)),
    db=0,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_keepalive=True,
)

async def get_cached(key: str, default: Any = None) -> Any:
    """
    Get value from Redis cache.
    Returns default if key not found or Redis fails.
    """
    try:
        value = redis_client.get(key)
        if value is None:
            return default
        return json.loads(value)
    except (redis.ConnectionError, redis.TimeoutError, json.JSONDecodeError):
        # Fail silently - cache miss, not an error
        return default
    except Exception as e:
        # Log but don't raise - cache failures should not break the API
        print(f"Cache get error: {e}")
        return default

async def set_cached(key: str, value: Any, ttl: int = 600) -> bool:
    """
    Set value in Redis cache with TTL in seconds.
    Returns True if successful, False if Redis fails.
    """
    try:
        redis_client.setex(key, ttl, json.dumps(value))
        return True
    except (redis.ConnectionError, redis.TimeoutError, json.JSONDecodeError) as e:
        # Fail silently - cache write failures should not break the API
        print(f"Cache set error: {e}")
        return False
    except Exception as e:
        # Non-serializable values (TypeError) and any other fault must not
        # propagate into the request path - a cache write is never critical.
        print(f"Cache set error: {e}")
        return False

async def invalidate(pattern: str) -> int:
    """
    Delete all cache entries matching pattern (e.g., 'schools:batch:*').
    Returns count of keys deleted.
    """
    try:
        keys = redis_client.keys(pattern)
        if not keys:
            return 0
        deleted = redis_client.delete(*keys)
        return deleted
    except (redis.ConnectionError, redis.TimeoutError):
        # Fail silently
        return 0
    except Exception as e:
        print(f"Cache invalidate error: {e}")
        return 0

async def health_check() -> bool:
    """Check Redis connectivity."""
    try:
        return redis_client.ping()
    except Exception:
        return False
