import nodemailer from "nodemailer";

export function createTransportFromEnv() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

export async function sendReminderEmail({ to, subject, html }) {
  const transporter = createTransportFromEnv();
  if (!transporter) return false;
  const from = process.env.FROM_EMAIL || "Video Calls <no-reply@example.com>";
  await transporter.sendMail({ from, to, subject, html });
  return true;
}
