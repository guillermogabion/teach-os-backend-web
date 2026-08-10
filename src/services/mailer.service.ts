import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || "465");
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

if (!SMTP_USER || !SMTP_PASS) {
    console.warn(
        "⚠️ Gmail SMTP credentials are not configured — emails will fail to send"
    );
}

const FROM_EMAIL = process.env.SMTP_FROM || SMTP_USER || "";
const FROM_NAME = process.env.SMTP_FROM_NAME || "TeachOS";
const FROM = `${FROM_NAME} <${FROM_EMAIL}>`;

const CLIENT_URL =
    process.env.CLIENT_URL || "http://localhost:5173";

const ADMIN_EMAILS = (process.env.ADMIN_NOTIFICATION_EMAIL || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
    },
});

// ─────────────────────────────────────────────
// Base email template
// ─────────────────────────────────────────────

const baseTemplate = (
    content: string,
    orgName = "TeachOS"
) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <style>
        body {
            margin: 0;
            padding: 0;
            background: #f5f7fb;
            font-family: Arial, Helvetica, sans-serif;
            color: #1f2937;
        }

        .container {
            max-width: 600px;
            margin: 40px auto;
            background: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.06);
        }

        .header {
            padding: 24px;
            background: #ffffff;
            border-bottom: 1px solid #e5e7eb;
        }

        .logo {
            font-size: 24px;
            font-weight: 700;
        }

        .content {
            padding: 32px 28px;
        }

        .footer {
            padding: 20px 28px;
            background: #f9fafb;
            color: #6b7280;
            font-size: 12px;
            text-align: center;
        }

        .code {
            margin: 24px 0;
            padding: 18px;
            background: #f3f4f6;
            border-radius: 8px;
            text-align: center;
            font-size: 24px;
            font-weight: 700;
            letter-spacing: 2px;
            font-family: monospace;
        }

        .btn {
            display: inline-block;
            padding: 12px 20px;
            background: #2563eb;
            color: #ffffff !important;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
        }

        .detail-table {
            width: 100%;
            border-collapse: collapse;
        }

        .detail-table td {
            padding: 8px;
            border-bottom: 1px solid #e5e7eb;
        }

        .label {
            font-weight: 600;
            width: 35%;
        }
    </style>
</head>

<body>

<div class="container">

    <div class="header">
        <div class="logo">
            ${orgName}
        </div>
    </div>

    <div class="content">
        ${content}
    </div>

    <div class="footer">
        © ${new Date().getFullYear()} ${orgName}. All rights reserved.
    </div>

</div>

</body>
</html>
`;


// ─────────────────────────────────────────────
// Generic email sender
// ─────────────────────────────────────────────

interface MailOptions {
    to: string;
    subject: string;
    html: string;
}

export const sendMail = async ({
    to,
    subject,
    html,
}: MailOptions) => {
    try {
        const info = await transporter.sendMail({
            from: FROM,
            to,
            subject,
            html: baseTemplate(html),
        });

        console.log(
            `📧 Email sent to ${to}: ${subject}`,
            info.messageId
        );

        return {
            success: true,
            messageId: info.messageId,
        };
    } catch (err) {
        console.error(
            "❌ Gmail SMTP email error:",
            err instanceof Error ? err.message : err
        );

        return {
            success: false,
            error:
                err instanceof Error
                    ? err.message
                    : "Unknown email error",
        };
    }
};


// ─────────────────────────────────────────────
// Activation key email
// ─────────────────────────────────────────────

export const sendActivationKeyEmail = async (
    to: string,
    name: string | null | undefined,
    planName: string,
    activationKey: string
) => {

    const greeting = name
        ? `Hi ${name},`
        : "Hi Educator,";

    const html = `
        <p>${greeting}</p>

        <p>
            Your payment for
            <strong>${planName}</strong>
            has been confirmed.
        </p>

        <p>
            Here is your premium activation key:
        </p>

        <div class="code">
            ${activationKey}
        </div>

        <p>
            To activate your premium access, open the
            TeachOS app and enter this key along with
            this email address.
        </p>

        <p>
            If you have any questions, simply reply
            to this email.
        </p>
    `;

    await sendMail({
        to,
        subject: "Your TeachOS Activation Key 🔑",
        html,
    });
};


// ─────────────────────────────────────────────
// Admin pending payment notification
// ─────────────────────────────────────────────

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

        console.warn(
            "⚠️ ADMIN_NOTIFICATION_EMAIL not set — skipping admin notification"
        );

        return;
    }

    const html = `
        <p>
            A new payment is waiting for approval.
        </p>

        <table class="detail-table">

            <tr>
                <td class="label">Payment ID</td>
                <td><code>${paymentId}</code></td>
            </tr>

            <tr>
                <td class="label">Plan</td>
                <td>${planName}</td>
            </tr>

            <tr>
                <td class="label">Amount</td>
                <td>${currency} ${amount}</td>
            </tr>

            <tr>
                <td class="label">Provider</td>
                <td>${provider}</td>
            </tr>

            <tr>
                <td class="label">Buyer</td>
                <td>
                    ${buyerName ?? "—"}
                    (${buyerEmail ?? "no email provided"})
                </td>
            </tr>

        </table>

        <p style="margin-top:24px;">
            <a
                class="btn"
                href="${CLIENT_URL}/admin/payments/${paymentId}"
            >
                Review this payment
            </a>
        </p>
    `;

    await Promise.all(
        ADMIN_EMAILS.map((to) =>
            sendMail({
                to,
                subject:
                    `New payment awaiting approval — ${planName}`,
                html,
            })
        )
    );
};


// ─────────────────────────────────────────────
// Admin 409 conflict notification
// ─────────────────────────────────────────────

export const sendAdminConflictErrorEmail = async (
    method: string,
    url: string,
    ip: string | undefined,
    errorMessage: string
) => {

    if (ADMIN_EMAILS.length === 0) {

        console.warn(
            "⚠️ ADMIN_NOTIFICATION_EMAIL not set — skipping 409 notification"
        );

        return;
    }

    const html = `
        <p>
            A <strong>409 Conflict</strong>
            error was thrown by the server.
        </p>

        <table class="detail-table">

            <tr>
                <td class="label">Route</td>
                <td>
                    <code>${method} ${url}</code>
                </td>
            </tr>

            <tr>
                <td class="label">Client IP</td>
                <td>${ip || "Unknown"}</td>
            </tr>

            <tr>
                <td class="label">Error Message</td>
                <td>${errorMessage}</td>
            </tr>

        </table>

        <p>
            Please check the server logs if further
            investigation is needed.
        </p>
    `;

    await Promise.all(
        ADMIN_EMAILS.map((to) =>
            sendMail({
                to,
                subject:
                    `🚨 409 Conflict Detected — ${errorMessage.substring(0, 40)}...`,
                html,
            })
        )
    );
};


// ─────────────────────────────────────────────
// Buyer conflict notification
// ─────────────────────────────────────────────

export const sendBuyerConflictEmail = async (
    to: string,
    errorMessage: string
) => {

    const html = `
        <p>Hi there,</p>

        <p>
            We received a recent request from you,
            but we were unable to process it.
        </p>

        <div
            style="
                background:#fef2f2;
                border:1px solid #fecaca;
                border-radius:6px;
                padding:12px 16px;
                margin:16px 0;
                color:#991b1b;
            "
        >
            <strong>Reason:</strong>
            ${errorMessage}
        </div>

        <p>
            If you believe you are receiving this
            message in error, simply reply to this
            email so we can assist you.
        </p>
    `;

    await sendMail({
        to,
        subject:
            "Notice regarding your recent TeachOS request",
        html,
    });
};
