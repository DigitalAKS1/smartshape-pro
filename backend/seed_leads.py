"""
Seed 50 realistic lead records into MongoDB.
Run: python seed_leads.py
Requires .env to be present in the same directory as main.py.
"""

import asyncio
import os
import uuid
import random
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / '.env')

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME   = os.environ.get("DB_NAME", "smartshape")

SCHOOL_NAMES = [
    "Delhi Public School Sector 45",
    "Ryan International School Noida",
    "The British School New Delhi",
    "Kendriya Vidyalaya IIT Delhi",
    "St. Columba's School Connaught Place",
    "Modern School Barakhamba",
    "Sanskriti School Chanakya Puri",
    "Lotus Valley International School",
    "G.D. Goenka World School Sohna",
    "Heritage Xperiential Learning School",
    "Amity International School Sector 46",
    "Bal Bharati Public School Pitam Pura",
    "DAV Public School Vasant Kunj",
    "Presidium School Indirapuram",
    "The Shriram School Aditi",
    "Springdales School Pusa Road",
    "Mount Abu Public School Rohini",
    "Air Force Golden Jubilee Institute",
    "Bhartiya Vidya Bhavan New Delhi",
    "Cambridge School Greater Noida",
    "Indraprastha International School",
    "Pathways School Noida",
    "Shalom Hills International School",
    "Tagore International School Vasant Vihar",
    "Vivekananda International School",
    "Apeejay School Sheikh Sarai",
    "Bluebells School International",
    "Christ Church School Jabalpur",
    "Don Bosco School New Delhi",
    "Ferns N Petals Academy Gurugram",
    "Galaxy High School Rajkot",
    "Hillwoods Academy Noida",
    "Imperial Heights School Ahmedabad",
    "Jaipuria School Vasundhara",
    "K.R. Mangalam World School",
    "Laxman Public School Prashant Vihar",
    "Maharaja Agarsain Public School",
    "Navyug School Lodhi Estate",
    "Oakridge International School",
    "Presidium School Gurugram",
    "Queen Mary's School Delhi",
    "Rainbow International School",
    "Suncity School Sector 54",
    "Techno India Group Public School",
    "Universal Public School New Delhi",
    "Vidya Devi Jindal School Hisar",
    "Woodstock School Mussoorie",
    "Xavier's International School",
    "YPS Public School Patiala",
    "Zoravar Academy Chandigarh",
]

CONTACTS = [
    ("Rajesh Kumar", "Principal"), ("Sunita Sharma", "Admin"), ("Mohan Gupta", "Purchase Head"),
    ("Priya Singh", "Director"), ("Anita Verma", "Trustee"), ("Suresh Mehta", "Principal"),
    ("Kavita Joshi", "Admin"), ("Ramesh Patel", "Purchase Head"), ("Deepa Nair", "Director"),
    ("Vikram Reddy", "Admin"), ("Sanjay Yadav", "Principal"), ("Meena Aggarwal", "Trustee"),
]

CITIES = ["Delhi", "Gurugram", "Noida", "Faridabad", "Ghaziabad", "Chandigarh", "Jaipur", "Ahmedabad"]
STAGES = ["new", "contacted", "demo", "quoted", "negotiation", "won", "lost", "retention"]
LEAD_TYPES = ["hot", "warm", "cold"]
SOURCES = ["Website", "Referral", "Exhibition", "Cold Call", "WhatsApp", "Ads"]
PRODUCTS = [
    "SmartShape 3D Printer Kit",
    "STEM Lab Bundle",
    "Coding Robotics Set",
    "AI Learning Module",
    "Maker Space Equipment",
    "3D Pen + Filament Pack",
    "Tinkercad School License",
    "Arduino STEM Kit",
]
SALES_NAMES = ["Priya Sharma", "Rahul Gupta", "Ankit Verma", "Deepika Singh", "Manish Kumar"]
SALES_EMAILS = ["priya@smartshape.in", "rahul@smartshape.in", "ankit@smartshape.in", "deepika@smartshape.in", "manish@smartshape.in"]

def rand_date(days_back_max=180, days_back_min=0):
    d = datetime.now(timezone.utc) - timedelta(days=random.randint(days_back_min, days_back_max))
    return d.strftime("%Y-%m-%d")

def rand_phone():
    return f"+91{random.randint(7000000000, 9999999999)}"

def rand_followup():
    d = datetime.now(timezone.utc) + timedelta(days=random.randint(-5, 30))
    return d.strftime("%Y-%m-%d")

async def seed():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # Get or create a dummy school_id mapping
    existing_schools = {s["school_name"]: s["school_id"] async for s in db.schools.find({}, {"school_name":1,"school_id":1})}

    inserted = 0
    for i, school_name in enumerate(SCHOOL_NAMES):
        contact_name, designation = random.choice(CONTACTS)
        stage = random.choice(STAGES)
        lead_type = random.choice(LEAD_TYPES)
        sp_idx = i % len(SALES_NAMES)

        # Edge cases
        if i == 5:   contact_name = "A" * 55  # >50 char name
        if i == 10:  school_name = school_name + " — " + "X" * 30  # long company
        if i == 15:  contact_name = "Jöhn Müller & Sons (Pvt.)"  # special chars
        if i == 20:  lead_type = "hot"; stage = "negotiation"  # high-value
        if i == 25:  stage = "won"

        lead_score = random.randint(0, 100) if lead_type == "hot" else random.randint(0, 60)
        next_followup = rand_followup() if stage not in ("won", "lost") else None

        lead = {
            "lead_id": str(uuid.uuid4()),
            "school_id": existing_schools.get(school_name, str(uuid.uuid4())),
            "company_name": school_name,
            "contact_name": contact_name,
            "designation": designation,
            "contact_phone": rand_phone(),
            "contact_email": f"{contact_name.lower().replace(' ', '.')[:12]}@{school_name.lower()[:8].replace(' ', '')}.edu.in",
            "source": random.choice(SOURCES),
            "lead_type": lead_type,
            "stage": stage,
            "interested_product": random.choice(PRODUCTS),
            "priority": random.choice(["low", "medium", "high"]),
            "next_followup_date": next_followup,
            "lead_score": lead_score,
            "assigned_to": SALES_EMAILS[sp_idx],
            "assigned_name": SALES_NAMES[sp_idx],
            "school_type": random.choice(["CBSE", "ICSE", "IB", "State Board"]),
            "school_city": random.choice(CITIES),
            "visit_required": random.choice([True, False, False]),
            "last_activity_date": rand_date(60),
            "notes": "Seeded dummy record for testing." if i % 5 == 0 else None,
            "tags": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "is_locked": False,
            "reassignment_count": 0,
        }

        await db.leads.insert_one(lead)
        inserted += 1
        print(f"  [{inserted:02d}] {school_name[:50]} | {stage} | {lead_type}")

    client.close()
    print(f"\n✓ Seeded {inserted} leads into '{DB_NAME}' database.")

if __name__ == "__main__":
    asyncio.run(seed())
