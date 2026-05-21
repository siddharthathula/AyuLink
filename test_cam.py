import httpx
import asyncio

async def test():
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get("http://localhost:8000/api/stream")
            print("Stream response code:", resp.status_code)
            # read some bytes
            async for chunk in resp.aiter_bytes():
                print("Got chunk length:", len(chunk))
                break
    except Exception as e:
        print("Error:", e)

asyncio.run(test())
