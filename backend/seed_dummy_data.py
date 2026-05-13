"""
SmartShape Pro — Dummy Data Seeder
Run: python seed_dummy_data.py
"""
import asyncio
import uuid
import os
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

import bcrypt
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL") or os.environ.get("MONGODB_URL")
DB_NAME   = os.environ.get("DB_NAME", "smartshape_prod")

client = AsyncIOMotorClient(MONGO_URL)
db     = client[DB_NAME]

def uid(prefix): return f"{prefix}_{uuid.uuid4().hex[:12]}"
def now(days=0): return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
def hp(pw): return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

# ── IDs we'll reuse across collections ───────────────────────────────────────
USERS = [
    {"user_id": uid("user"), "email": "admin@smartshape.in",   "name": "Admin User",    "role": "admin",    "pw": "admin123"},
    {"user_id": uid("user"), "email": "sales1@smartshape.in",  "name": "Rahul Sharma",  "role": "sales_person", "pw": "sales123"},
    {"user_id": uid("user"), "email": "sales2@smartshape.in",  "name": "Priya Patel",   "role": "sales_person", "pw": "sales123"},
    {"user_id": uid("user"), "email": "store@smartshape.in",   "name": "Store Manager", "role": "store",    "pw": "store123"},
    {"user_id": uid("user"), "email": "accounts@smartshape.in","name": "Accounts Team", "role": "accounts", "pw": "acct123"},
]

SCHOOL_IDS  = [uid("school") for _ in range(5)]
CONTACT_IDS = [uid("contact") for _ in range(6)]
LEAD_IDS    = [uid("lead")   for _ in range(5)]
PACKAGE_IDS = [uid("pkg")    for _ in range(3)]
DIE_IDS     = [uid("die")    for _ in range(12)]
QUOT_IDS    = [uid("quot")   for _ in range(4)]
ORDER_IDS   = [uid("order")  for _ in range(2)]
DISPATCH_IDS= [uid("disp")   for _ in range(1)]

ALL_MODULES = [
    "dashboard","quotations","inventory","stock_management","purchase_alerts",
    "package_master","physical_count","analytics","payroll","accounts",
    "hr","store","field_sales","leads","settings","user_management","sales_portal",
]

async def seed_users():
    await db.users.delete_many({})
    docs = []
    for u in USERS:
        mods = ALL_MODULES if u["role"] == "admin" else (
            ["sales_portal","quotations","leads"] if u["role"] == "sales_person" else
            ["store","inventory","stock_management"] if u["role"] == "store" else
            ["accounts","payroll"]
        )
        docs.append({
            "user_id": u["user_id"], "email": u["email"],
            "password_hash": hp(u["pw"]), "name": u["name"],
            "role": u["role"], "assigned_modules": mods,
            "is_active": True, "created_at": now(),
        })
    await db.users.insert_many(docs)
    print(f"  ✓ {len(docs)} users")

async def seed_schools():
    await db.schools.delete_many({})
    schools = [
        ("Delhi Public School",    "CBSE",  "Delhi",     "9810001001", "dps@school.in"),
        ("Ryan International",     "ICSE",  "Mumbai",    "9820002002", "ryan@school.in"),
        ("DAV Public School",      "CBSE",  "Pune",      "9830003003", "dav@school.in"),
        ("Kendriya Vidyalaya",     "CBSE",  "Bangalore", "9840004004", "kv@school.in"),
        ("St. Mary's Convent",     "ICSE",  "Chennai",   "9850005005", "stmary@school.in"),
    ]
    docs = []
    for i, (name, board, city, phone, email) in enumerate(schools):
        docs.append({
            "school_id": SCHOOL_IDS[i], "school_name": name,
            "school_type": "Private", "board": board,
            "city": city, "state": "India", "pincode": f"11000{i+1}",
            "phone": phone, "email": email,
            "primary_contact_name": f"Principal {name.split()[0]}",
            "designation": "Principal",
            "school_strength": 1000 + i*200,
            "number_of_branches": i+1,
            "annual_budget_range": "5-10L",
            "existing_vendor": "None",
            "last_activity_date": now(-i), "created_by": "admin@smartshape.in",
            "created_at": now(-30+i),
        })
    await db.schools.insert_many(docs)
    print(f"  ✓ {len(docs)} schools")

async def seed_contacts():
    await db.contacts.delete_many({})
    contacts = [
        ("Amit Verma",    "9811111111", "amit@dps.in",    "Delhi Public School",  "Principal"),
        ("Sunita Rao",    "9822222222", "sunita@ryan.in", "Ryan International",   "Vice Principal"),
        ("Rajesh Kumar",  "9833333333", "rajesh@dav.in",  "DAV Public School",    "Purchase Head"),
        ("Meena Singh",   "9844444444", "meena@kv.in",    "Kendriya Vidyalaya",   "Admin"),
        ("John Thomas",   "9855555555", "john@stmary.in", "St. Mary's Convent",   "Coordinator"),
        ("Pooja Sharma",  "9866666666", "pooja@new.in",   "New Horizon School",   "Teacher"),
    ]
    docs = []
    for i, (name, phone, email, company, desig) in enumerate(contacts):
        docs.append({
            "contact_id": CONTACT_IDS[i], "name": name,
            "phone": phone, "email": email, "company": company,
            "designation": desig, "source": "field_visit",
            "status": "active", "converted_to_lead": i < 4,
            "lead_id": LEAD_IDS[i] if i < 4 else None,
            "last_activity_date": now(-i),
            "created_by": USERS[1]["email"], "created_at": now(-20+i),
        })
    await db.contacts.insert_many(docs)
    print(f"  ✓ {len(docs)} contacts")

async def seed_leads():
    await db.leads.delete_many({})
    stages = ["new","contacted","qualified","proposal_sent","negotiation","won","lost"]
    docs = []
    for i in range(5):
        docs.append({
            "lead_id": LEAD_IDS[i],
            "school_id": SCHOOL_IDS[i],
            "company_name": ["Delhi Public School","Ryan International","DAV Public School","Kendriya Vidyalaya","St. Mary's Convent"][i],
            "contact_name": ["Amit Verma","Sunita Rao","Rajesh Kumar","Meena Singh","John Thomas"][i],
            "designation": "Principal",
            "contact_phone": f"981111111{i}",
            "contact_email": f"lead{i}@school.in",
            "source": ["field_visit","referral","website","cold_call","exhibition"][i],
            "lead_type": "school",
            "interested_product": "Shape Kit",
            "stage": stages[i % len(stages)],
            "priority": ["high","medium","low"][i % 3],
            "next_followup_date": now(i+2),
            "assigned_to": USERS[1+i%2]["user_id"],
            "assigned_name": USERS[1+i%2]["name"],
            "notes": f"Interested in package deal. Follow up on {now(i+2)[:10]}",
            "last_activity_date": now(-i),
            "created_by": USERS[1]["email"], "created_at": now(-25+i),
            "updated_at": now(-i), "pipeline_history": [],
        })
    await db.leads.insert_many(docs)
    print(f"  ✓ {len(docs)} leads")

async def seed_packages():
    await db.packages.delete_many({})
    docs = [
        {
            "package_id": PACKAGE_IDS[0], "name": "starter", "display_name": "Starter Kit",
            "base_price": 15000, "std_die_qty": 20, "machine_qty": 1, "large_die_qty": 5,
            "gst_pct": 18, "is_active": True,
            "items": [{"die_id": DIE_IDS[i], "qty": 1} for i in range(5)],
        },
        {
            "package_id": PACKAGE_IDS[1], "name": "standard", "display_name": "Standard Kit",
            "base_price": 28000, "std_die_qty": 40, "machine_qty": 2, "large_die_qty": 10,
            "gst_pct": 18, "is_active": True,
            "items": [{"die_id": DIE_IDS[i], "qty": 2} for i in range(8)],
        },
        {
            "package_id": PACKAGE_IDS[2], "name": "premium", "display_name": "Premium Kit",
            "base_price": 50000, "std_die_qty": 60, "machine_qty": 3, "large_die_qty": 15,
            "gst_pct": 18, "is_active": True,
            "items": [{"die_id": DIE_IDS[i], "qty": 3} for i in range(12)],
        },
    ]
    await db.packages.insert_many(docs)
    print(f"  ✓ {len(docs)} packages")

async def seed_dies():
    await db.dies.delete_many({})
    die_data = [
        ("SS-001", "Circle Die",       "standard", "Geometric",  50, 120),
        ("SS-002", "Square Die",       "standard", "Geometric",  50, 95),
        ("SS-003", "Triangle Die",     "standard", "Geometric",  40, 80),
        ("SS-004", "Star Die",         "standard", "Decorative", 30, 60),
        ("SS-005", "Heart Die",        "standard", "Decorative", 30, 75),
        ("SS-006", "Oval Die",         "standard", "Geometric",  40, 55),
        ("SS-007", "Diamond Die",      "standard", "Geometric",  35, 48),
        ("SS-008", "Flower Die",       "standard", "Decorative", 25, 40),
        ("SS-009", "Animal Shape Die", "large",    "Thematic",   20, 30),
        ("SS-010", "Alphabet Die Set", "large",    "Educational",15, 25),
        ("SS-011", "Number Die Set",   "large",    "Educational",15, 22),
        ("SS-012", "Border Die",       "large",    "Decorative", 10, 18),
    ]
    docs = []
    for i, (code, name, dtype, cat, min_level, stock) in enumerate(die_data):
        docs.append({
            "die_id": DIE_IDS[i], "code": code, "name": name,
            "type": dtype, "category": cat, "min_level": min_level,
            "description": f"{name} for school craft activities",
            "stock_qty": stock, "reserved_qty": 0,
            "image_url": None, "is_active": True,
        })
    await db.dies.insert_many(docs)
    print(f"  ✓ {len(docs)} dies (inventory)")

async def seed_quotations():
    await db.quotations.delete_many({})
    import secrets
    statuses = [
        ("confirmed", "submitted"),
        ("confirmed", "submitted"),
        ("draft",     "not_sent"),
        ("pending",   "sent"),
    ]
    schools = [
        ("Delhi Public School",  "Amit Verma",  "amit@dps.in",  "9811111111"),
        ("Ryan International",   "Sunita Rao",  "sunita@ryan.in","9822222222"),
        ("DAV Public School",    "Rajesh Kumar","rajesh@dav.in", "9833333333"),
        ("Kendriya Vidyalaya",   "Meena Singh", "meena@kv.in",  "9844444444"),
    ]
    docs = []
    for i in range(4):
        q_status, c_status = statuses[i]
        school_name, contact_name, email, phone = schools[i]
        pkg_idx = i % 3
        base = [15000, 28000, 50000][pkg_idx]
        disc1, disc2 = 5.0, 3.0
        gst = 18.0
        after_d1  = base * (1 - disc1/100)
        after_d2  = after_d1 * (1 - disc2/100)
        freight   = 500
        gst_amt   = after_d2 * gst / 100
        grand     = after_d2 + gst_amt + freight

        lines = [
            {
                "die_id": DIE_IDS[j], "die_code": f"SS-{j+1:03d}",
                "die_name": ["Circle Die","Square Die","Triangle Die","Star Die",
                             "Heart Die","Oval Die","Diamond Die","Flower Die"][j % 8],
                "die_type": "standard", "qty": 2, "unit_price": 800,
                "line_total": 1600,
            }
            for j in range(4 + i)
        ]

        token = secrets.token_urlsafe(24) if c_status != "not_sent" else None
        docs.append({
            "quotation_id":    QUOT_IDS[i],
            "quote_number":    f"QT-2024-{1000+i}",
            "package_id":      PACKAGE_IDS[pkg_idx],
            "package_name":    ["Starter Kit","Standard Kit","Premium Kit"][pkg_idx],
            "principal_name":  contact_name,
            "school_name":     school_name,
            "school_id":       SCHOOL_IDS[i],
            "address":         f"{i+1} Main Street, City",
            "customer_email":  email,
            "customer_phone":  phone,
            "customer_gst":    f"27ABCDE1234F{i+1}Z5",
            "sales_person_id": USERS[1+i%2]["user_id"],
            "sales_person_name": USERS[1+i%2]["name"],
            "sales_person_email": USERS[1+i%2]["email"],
            "discount1_pct":   disc1, "discount2_pct": disc2,
            "freight_amount":  freight, "freight_gst_pct": 18.0,
            "subtotal":        base, "gst_amount": gst_amt,
            "total_with_gst":  base + gst_amt,
            "disc1_amount":    base * disc1/100,
            "after_disc1":     after_d1,
            "disc2_amount":    after_d1 * disc2/100,
            "after_disc2":     after_d2,
            "sub_total_after": after_d2,
            "freight_total":   freight * 1.18,
            "grand_total":     round(grand, 2),
            "lines":           lines,
            "quotation_status": q_status,
            "catalogue_status": c_status,
            "catalogue_token":  token,
            "catalogue_sent_at":    now(-10+i) if token else None,
            "catalogue_opened_at":  now(-8+i)  if c_status == "submitted" else None,
            "catalogue_submitted_at": now(-5+i) if c_status == "submitted" else None,
            "version": 1, "parent_quotation_id": None,
            "created_by": USERS[1+i%2]["email"],
            "created_at": now(-15+i),
        })
    await db.quotations.insert_many(docs)
    print(f"  ✓ {len(docs)} quotations (2 submitted, 1 draft, 1 sent)")

async def seed_catalogue_selections():
    await db.catalogue_selections.delete_many({})
    await db.catalogue_selection_items.delete_many({})

    for i in range(2):  # first 2 quotations are submitted
        sel_id = uid("sel")
        await db.catalogue_selections.insert_one({
            "selection_id": sel_id,
            "quotation_id": QUOT_IDS[i],
            "quote_number": f"QT-2024-{1000+i}",
            "school_name":  ["Delhi Public School","Ryan International"][i],
            "selected_count": 3 + i,
            "submitted_at": now(-5+i),
        })
        for j in range(3 + i):
            await db.catalogue_selection_items.insert_one({
                "item_id": uid("csi"),
                "selection_id": sel_id,
                "quotation_id": QUOT_IDS[i],
                "die_id": DIE_IDS[j],
                "die_code": f"SS-{j+1:03d}",
                "die_name": ["Circle Die","Square Die","Triangle Die","Star Die","Heart Die"][j],
                "die_type": "standard",
            })
    print(f"  ✓ catalogue selections for 2 submitted quotations")

async def seed_orders():
    await db.orders.delete_many({})
    await db.order_items.delete_many({})
    await db.order_timeline.delete_many({})

    order_data = [
        (0, "delivered", "dispatched", 17700, 17700),
        (1, "confirmed", "in_production", 33000, 16500),
    ]
    docs = []
    for i, (qi, o_status, prod_stage, grand, paid) in enumerate(order_data):
        items_count = 3 + i
        docs.append({
            "order_id":     ORDER_IDS[i],
            "order_number": f"ORD-2024-{2000+i}",
            "quotation_id": QUOT_IDS[qi],
            "quote_number": f"QT-2024-{1000+qi}",
            "school_id":    SCHOOL_IDS[qi],
            "school_name":  ["Delhi Public School","Ryan International"][i],
            "lead_id":      LEAD_IDS[qi],
            "package_name": ["Starter Kit","Standard Kit"][i],
            "total_items":  items_count,
            "grand_total":  grand,
            "order_status": o_status,
            "production_stage": prod_stage,
            "payment_threshold_pct": 50,
            "payment_received": paid,
            "payment_status": "paid" if paid >= grand else "partial",
            "total_paid": paid,
            "dispatch_date": now(5+i),
            "notes": f"Priority order for {['Delhi Public School','Ryan International'][i]}",
            "created_by": USERS[1]["email"],
            "created_at": now(-10+i),
            "updated_at": now(-2+i),
        })

    await db.orders.insert_many(docs)

    # Order items
    for i, order_doc in enumerate(docs):
        for j in range(order_doc["total_items"]):
            await db.order_items.insert_one({
                "order_item_id": uid("oi"),
                "order_id":  ORDER_IDS[i],
                "die_id":    DIE_IDS[j],
                "die_name":  ["Circle Die","Square Die","Triangle Die","Star Die","Heart Die"][j],
                "die_code":  f"SS-{j+1:03d}",
                "die_type":  "standard",
                "die_image_url": None,
                "quantity":  2,
                "status":    "delivered" if order_doc["order_status"] == "delivered" else "on_hold",
            })

    # Timelines
    for i in range(2):
        for status in ["pending","confirmed"]:
            await db.order_timeline.insert_one({
                "timeline_id": uid("tl"),
                "order_id": ORDER_IDS[i],
                "status": status,
                "note": f"Order {status}",
                "updated_by": USERS[0]["email"],
                "timestamp": now(-9+i),
            })

    print(f"  ✓ {len(docs)} orders with items and timelines")

async def seed_payments():
    await db.payments.delete_many({})
    payments = [
        (ORDER_IDS[0], 17700, "neft",  "UTR123456789", now(-8)),
        (ORDER_IDS[1], 16500, "upi",   "UPI987654321", now(-4)),
    ]
    docs = [
        {
            "payment_id": uid("pay"),
            "order_id": oid, "amount": amt, "method": method,
            "reference": ref, "notes": "Payment received",
            "recorded_by": USERS[4]["email"],
            "payment_date": now(-5), "created_at": now(-5),
        }
        for oid, amt, method, ref, _ in payments
    ]
    await db.payments.insert_many(docs)
    print(f"  ✓ {len(docs)} payments")

async def seed_dispatches():
    await db.dispatches.delete_many({})
    doc = {
        "dispatch_id":     DISPATCH_IDS[0],
        "dispatch_number": "DSP-2024-3001",
        "order_id":        ORDER_IDS[0],
        "order_number":    "ORD-2024-2000",
        "school_name":     "Delhi Public School",
        "school_id":       SCHOOL_IDS[0],
        "dispatch_date":   now(-6),
        "courier_name":    "BlueDart",
        "tracking_number": "BD123456789IN",
        "notes":           "Fragile — handle with care",
        "status":          "delivered",
        "created_by":      USERS[0]["email"],
        "created_at":      now(-6),
    }
    await db.dispatches.insert_one(doc)
    print(f"  ✓ 1 dispatch")

async def seed_stock_movements():
    await db.stock_movements.delete_many({})
    types = ["inward","outward","adjustment"]
    docs = []
    for i in range(6):
        docs.append({
            "movement_id":     uid("mv"),
            "die_id":          DIE_IDS[i % len(DIE_IDS)],
            "die_code":        f"SS-{(i%12)+1:03d}",
            "die_name":        ["Circle Die","Square Die","Triangle Die","Star Die","Heart Die","Oval Die"][i],
            "movement_type":   types[i % 3],
            "quantity":        10 + i*5,
            "sales_person_id": USERS[1]["user_id"],
            "sales_person_name": USERS[1]["name"],
            "notes":           f"Stock {types[i%3]} for order",
            "movement_date":   now(-10+i),
            "reference_number": f"REF-{2000+i}",
            "created_at":      now(-10+i),
        })
    await db.stock_movements.insert_many(docs)
    print(f"  ✓ {len(docs)} stock movements")

async def seed_hr():
    await db.leaves.delete_many({})
    await db.designations.delete_many({})

    # Designations
    desigs = [
        ("Sales Executive",  "SE",  "junior"),
        ("Sales Manager",    "SM",  "senior"),
        ("Store Keeper",     "SK",  "junior"),
        ("Accounts Officer", "AO",  "junior"),
    ]
    desig_docs = []
    for name, code, level in desigs:
        desig_docs.append({
            "designation_id": uid("desig"), "name": name, "code": code,
            "role_level": level, "default_modules": [],
            "description": f"{name} role", "is_system": False,
            "is_active": True, "created_at": now(),
        })
    await db.designations.insert_many(desig_docs)

    # Leaves
    leave_types = ["casual","sick","earned","half_day"]
    leave_docs = []
    for i, user in enumerate(USERS[1:]):
        leave_docs.append({
            "leave_id":   uid("leave"),
            "user_id":    user["user_id"],
            "user_email": user["email"],
            "user_name":  user["name"],
            "leave_type": leave_types[i % len(leave_types)],
            "from_date":  now(5+i)[:10],
            "to_date":    now(6+i)[:10],
            "half_day":   False,
            "reason":     "Personal work",
            "status":     ["approved","pending","approved","pending"][i % 4],
            "approved_by": USERS[0]["email"] if i % 2 == 0 else None,
            "remarks":    "Approved" if i % 2 == 0 else "",
            "days":       1,
            "created_at": now(-3+i),
        })
    await db.leaves.insert_many(leave_docs)
    print(f"  ✓ {len(desig_docs)} designations, {len(leave_docs)} leave records")

async def seed_activity_logs():
    await db.activity_logs.delete_many({})
    actions = [
        ("login",         "User logged in"),
        ("create_quotation", "Created quotation QT-2024-1000"),
        ("send_catalogue","Sent catalogue to Delhi Public School"),
        ("create_order",  "Created order ORD-2024-2000"),
        ("record_payment","Recorded payment ₹17,700"),
        ("dispatch",      "Dispatched order ORD-2024-2000"),
    ]
    docs = []
    for i, (action, desc) in enumerate(actions):
        docs.append({
            "log_id": uid("log"),
            "user_email": USERS[i % len(USERS)]["email"],
            "user_name":  USERS[i % len(USERS)]["name"],
            "action":     action,
            "description": desc,
            "module":     ["auth","quotations","quotations","orders","accounts","orders"][i],
            "timestamp":  now(-10+i),
        })
    await db.activity_logs.insert_many(docs)
    print(f"  ✓ {len(docs)} activity logs")

async def main():
    print("\n[SEED] Seeding SmartShape Pro dummy data...\n")
    await seed_users()
    await seed_schools()
    await seed_contacts()
    await seed_leads()
    await seed_packages()
    await seed_dies()
    await seed_quotations()
    await seed_catalogue_selections()
    await seed_orders()
    await seed_payments()
    await seed_dispatches()
    await seed_stock_movements()
    await seed_hr()
    await seed_activity_logs()

    print("\n[DONE] Login credentials:")
    print("   Admin:    admin@smartshape.in   / admin123")
    print("   Sales:    sales1@smartshape.in  / sales123")
    print("   Store:    store@smartshape.in   / store123")
    print("   Accounts: accounts@smartshape.in / acct123\n")
    client.close()

if __name__ == "__main__":
    asyncio.run(main())
