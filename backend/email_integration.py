# Backend API endpoint to save settings and send emails using Gmail SMTP

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

# Add to backend/server.py

# Settings endpoints
@api_router.post("/settings/email")
async def save_email_settings(request: Request, settings: dict):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Save to database
    await db.settings.update_one(
        {"type": "email"},
        {"$set": {**settings, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Email settings saved"}

@api_router.get("/settings/email")
async def get_email_settings(request: Request):
    user = await get_current_user(request)
    settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
    if not settings:
        return {"sender_name": "SmartShape Pro", "sender_email": "", "gmail_app_password": "", "enabled": False}
    return settings

# Email sending function
async def send_catalogue_email(quotation_id: str):
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        return {"success": False, "error": "Quotation not found"}
    
    # Get email settings
    email_settings = await db.settings.find_one({"type": "email"}, {"_id": 0})
    if not email_settings or not email_settings.get("enabled"):
        return {"success": False, "error": "Email not configured"}
    
    sender_email = email_settings.get("sender_email")
    app_password = email_settings.get("gmail_app_password")
    sender_name = email_settings.get("sender_name", "SmartShape Pro")
    
    if not sender_email or not app_password:
        return {"success": False, "error": "Email credentials missing"}
    
    # Generate catalogue URL
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_url = f"{frontend_url}/catalogue/{quot['catalogue_token']}"
    
    # Build email
    subject = f"Catalogue Link - {quot['school_name']}"
    body = f"""Dear {quot['principal_name']},

Thank you for your interest in SmartShape Pro products!

We are pleased to share your personalized catalogue for {quot['package_name']}.

Please click the link below to view and select your preferred dies:
{catalogue_url}

For any queries, please contact:
{quot['sales_person_name']}
Email: {quot['sales_person_email']}

Best regards,
SmartShape Pro Team"""
    
    try:
        # Create message
        msg = MIMEMultipart()
        msg['From'] = f"{sender_name} <{sender_email}>"
        msg['To'] = quot['customer_email']
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        
        # Send via Gmail SMTP
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
            smtp.login(sender_email, app_password)
            smtp.send_message(msg)
        
        return {"success": True, "message": "Email sent successfully"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# Update send catalogue endpoint to actually send email
@api_router.post("/quotations/{quotation_id}/send-catalogue-email")
async def send_catalogue_with_email(quotation_id: str, request: Request):
    user = await get_current_user(request)
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    
    # Generate token if not exists
    if not quot.get("catalogue_token"):
        token = str(uuid.uuid4())
        await db.quotations.update_one(
            {"quotation_id": quotation_id},
            {"$set": {
                "catalogue_token": token,
                "catalogue_status": "sent",
                "catalogue_sent_at": datetime.now(timezone.utc).isoformat(),
                "quotation_status": "sent"
            }}
        )
    else:
        token = quot["catalogue_token"]
    
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    catalogue_url = f"{frontend_url}/catalogue/{token}"
    
    # Try to send email
    email_result = await send_catalogue_email(quotation_id)
    
    return {
        "catalogue_url": catalogue_url,
        "email_sent": email_result.get("success", False),
        "email_error": email_result.get("error"),
        "message": "Catalogue link generated" + (" and email sent" if email_result.get("success") else "")
    }
