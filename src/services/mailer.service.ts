import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.mailtrap.io",
    // Always include the radix (10) when using parseInt
    port: parseInt(process.env.SMTP_PORT || "587", 10),

    // Only pass the auth object if the environment variables actually exist
    ...(process.env.SMTP_USER && {
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    }),
});

const FROM = process.env.SMTP_FROM || "no-reply@TeachOs.app";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// Comma-separated list of admin addresses to notify about pending payments,
// e.g. ADMIN_NOTIFICATION_EMAIL="admin1@TeachOs.app,admin2@TeachOs.app"
const ADMIN_EMAILS = (process.env.ADMIN_NOTIFICATION_EMAIL || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

const baseTemplate = (content: string, orgName = "TeachOs") => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body { font-family: Arial, sans-serif; background: #f1f5f9; margin: 0; padding: 0; }
    .container { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #0d87f5; padding: 28px 32px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; }
    .header p { color: #bfdbfe; margin: 4px 0 0; font-size: 13px; }
    .body { padding: 32px; color: #334155; font-size: 15px; line-height: 1.6; }
    .btn { display: inline-block; margin: 24px 0; padding: 12px 28px; background: #0d87f5; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; }
    .footer { padding: 20px 32px; background: #f8fafc; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0; }
    .code { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 20px; font-family: monospace; font-size: 22px; letter-spacing: 4px; text-align: center; color: #0d87f5; font-weight: bold; }
    table.detail-table td { padding: 6px 0; font-size: 14px; }
    table.detail-table td.label { color: #94a3b8; width: 120px; }
    .logo { 
        width: 64px; 
        height: 64px; 
        border-radius: 16px; /* Matches the rounded corners of your app icon */
        margin-bottom: 8px;
    }
    </style>
</head>
<body>
  <div class="container">
    <div class="header">
     <div class="header">
        <img src="${CLIENT_URL}/teachOs_logo_small.png" alt="TeacherOS Logo" class="logo" />
        <div class="header">
      <img src="${CLIENT_URL}/teachOs_logo_small.png" alt="TeacherOS Logo" class="logo" />
      <h1>${orgName}</h1>
      <p>Teacher Productivity Platform</p>
    </div>
        <p>Teacher Productivity Platform</p>
    </div>
      <p>Teacher Productivity Platform</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} TeachOs · <a href="${CLIENT_URL}" style="color:#0d87f5">${CLIENT_URL}</a>
    </div>
  </div>
</body>
</html>
`;

interface MailOptions {
    to: string;
    subject: string;
    html: string;
}

export const sendMail = async ({ to, subject, html }: MailOptions) => {
    try {
        await transporter.sendMail({ from: FROM, to, subject, html: baseTemplate(html) });
        console.log(`📧 Email sent to ${to}: ${subject}`);
    } catch (err) {
        console.error("❌ Email send error:", (err as Error).message);
        // Don't throw — email failure shouldn't break the API
    }
};

/**
 * Sends the beautifully formatted activation key email to the buyer.
 */
export const sendActivationKeyEmail = async (
    to: string,
    name: string | null | undefined,
    planName: string,
    activationKey: string
) => {
    const greeting = name ? `Hi ${name},` : "Hi Educator,";

    const html = `
        <p>${greeting}</p>
        <p>Your payment for <strong>${planName}</strong> has been confirmed. Here is your premium activation key:</p>
       
        <div class="code">${activationKey}</div>
       
        <p>To activate, open the TeachOs app, enter this key along with this email address, and you're set.</p>
        <p>If you have any questions, simply reply to this email.</p>
    `;

    await sendMail({
        to,
        subject: "Your TeachOs Activation Key 🔑",
        html,
    });
};

/**
 * Notifies admins (via ADMIN_NOTIFICATION_EMAIL) that a new payment is
 * sitting in PENDING and needs manual review/approval. Best-effort —
 * if no admin addresses are configured, this just logs a warning and
 * skips rather than throwing, since it should never block a buyer's
 * payment from being recorded.
 */
export const sendAdminPendingPaymentEmail = async (
    paymentId: string,
    buyerEmail: string | null | undefined,
    buyerName: string | null | undefined,
    planName: string,
    amount: number,
    currency: string,
    provider: string
) => {
    if (ADMIN_EMAILS.length === 0) {
        console.warn("⚠️ ADMIN_NOTIFICATION_EMAIL not set — skipping admin pending-payment notification");
        return;
    }

    const html = `
        <p>A new payment is waiting for approval.</p>
        <table class="detail-table" style="width:100%; border-collapse:collapse; margin: 16px 0;">
          <tr><td class="label">Payment ID</td><td><code>${paymentId}</code></td></tr>
          <tr><td class="label">Plan</td><td>${planName}</td></tr>
          <tr><td class="label">Amount</td><td>${currency} ${amount}</td></tr>
          <tr><td class="label">Provider</td><td>${provider}</td></tr>
          <tr><td class="label">Buyer</td><td>${buyerName ?? "—"} (${buyerEmail ?? "no email provided"})</td></tr>
        </table>
        <p><a class="btn" href="${CLIENT_URL}/admin/payments/${paymentId}">Review this payment</a></p>
    `;

    await Promise.all(
        ADMIN_EMAILS.map((to) =>
            sendMail({
                to,
                subject: `New payment awaiting approval — ${planName}`,
                html,
            })
        )
    );
};

export const sendAdminConflictErrorEmail = async (
    method: string,
    url: string,
    ip: string | undefined,
    errorMessage: string
) => {
    if (ADMIN_EMAILS.length === 0) {
        console.warn("⚠️ ADMIN_NOTIFICATION_EMAIL not set — skipping 409 error notification");
        return;
    }

    const html = `
        <p>A <strong>409 Conflict</strong> error was thrown by the server.</p>
        <table class="detail-table" style="width:100%; border-collapse:collapse; margin: 16px 0;">
          <tr><td class="label">Route</td><td><code>${method} ${url}</code></td></tr>
          <tr><td class="label">Client IP</td><td>${ip || "Unknown"}</td></tr>
          <tr><td class="label">Error Message</td><td>${errorMessage}</td></tr>
        </table>
        <p>Please check the server logs if further investigation is needed.</p>
    `;

    await Promise.all(
        ADMIN_EMAILS.map((to) =>
            sendMail({
                to,
                subject: `🚨 409 Conflict Detected — ${errorMessage.substring(0, 40)}...`,
                html,
            })
        )
    );
};

export const sendBuyerConflictEmail = async (
    to: string,
    errorMessage: string
) => {
    const html = `
        <p>Hi there,</p>
        <p>We received a recent request from you, but we were unable to process it.</p>
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px 16px; margin: 16px 0; color: #991b1b;">
            <strong>Reason:</strong> ${errorMessage}
        </div>
        <p>If you believe you are receiving this message in error, please reply to this email so we can assist you.</p>
    `;

    await sendMail({
        to,
        subject: "Notice regarding your recent TeachOs request",
        html,
    });
};