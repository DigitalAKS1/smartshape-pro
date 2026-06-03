import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient
async def run():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client.smartshape_prod
    u = await db.users.find_one({"email":"info@smartshape.in"},{"_id":0,"email":1,"role":1,"name":1})
    print("User:", u)
    q = await db.quotations.find_one({"quote_number":"Q-2026-001"},{"_id":0,"catalogue_token":1,"catalogue_status":1})
    print("Quote:", q)
    client.close()
asyncio.run(run())
