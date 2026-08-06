import axios from 'axios';
import config from '../config';

export const sendOtpEmail = async (to: string, otp: string): Promise<void> => {
  const html = buildOtpHtml(otp);

  const canFallbackToSmtp =
    config.isDev || Boolean(config.email.user && config.email.pass) || config.email.mode !== 'brevo';

  if (config.email.mode === 'brevo' && config.email.brevoApiKey) {
    try {
      const { data } = await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: {
            name: 'Piki Food',
            email: config.email.from,
          },
          to: [{ email: to }],
          subject: 'Your Piki Food verification code',
          htmlContent: html,
        },
        {
          headers: {
            'api-key': config.email.brevoApiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 15000,
        },
      );
      console.log(`[EMAIL] OTP sent to ${to} (id: ${data.messageId})`);
      return;
    } catch (err: any) {
      console.error('[EMAIL] Brevo send failed:', err?.response?.data || err?.message || err);
      if (canFallbackToSmtp) {
        console.warn('[EMAIL] Falling back to SMTP transport');
      } else {
        throw err;
      }
    }
  }

  const nodemailer = await import('nodemailer');

  let transporter;

  if (config.email.mode === 'self-hosted') {
    transporter = nodemailer.createTransport({
      host: 'localhost',
      port: config.email.selfHostedPort,
      ignoreTLS: true,
    });
  } else if (config.email.user && config.email.pass) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });
  } else {
    if (config.nodeEnv === 'production') {
      throw new Error('EMAIL_USER and EMAIL_PASS must be configured in production');
    }
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log(`[EMAIL] Dev mode: using Ethereal test account: ${testAccount.user}`);
  }

  const info = await transporter.sendMail({
    from: `"Piki Food" <${config.email.from}>`,
    to,
    subject: 'Your Piki Food verification code',
    html,
  });

  console.log(`[EMAIL] OTP sent to ${to} (messageId: ${info.messageId})`);
};

function buildOtpHtml(otp: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 40px 20px; background-color: #ffffff;">

  <!-- Header / Brand -->
  <div style="margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid #e2e2e2;">
    <span style="font-size: 24px; font-weight: 700; color: #006d36; letter-spacing: -0.5px;">Piki Food</span>
  </div>

  <!-- Content Title -->
  <h1 style="font-size: 24px; font-weight: 500; color: #000000; margin: 0 0 24px 0; line-height: 1.2; letter-spacing: -0.3px;">
    Here is your verification code
  </h1>

  <!-- Main Body Message -->
  <p style="font-size: 16px; line-height: 24px; color: #333333; margin: 0 0 32px 0;">
    Use the following 4-digit verification code to complete your request. This security code is strictly private and expires in 5 minutes.
  </p>

  <!-- Uber-Style OTP Content Block -->
  <div style="background-color: #f3f3f3; padding: 24px; border-left: 4px solid #006d36; margin: 0 0 32px 0;">
    <div style="font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; color: #555555; margin-bottom: 8px;">
      Verification Code
    </div>
    <div style="font-size: 38px; font-weight: 700; color: #000000; letter-spacing: 4px; line-height: 1;">
      ${otp}
    </div>
  </div>

  <!-- Security Sub-note -->
  <p style="font-size: 14px; line-height: 20px; color: #777777; margin: 0 0 40px 0;">
    If you did not initiate this request, someone else may have typed your information by mistake. You can safely ignore this communication.
  </p>

  <!-- Divider Line -->
  <hr style="border: none; border-top: 1px solid #e2e2e2; margin: 0 0 24px 0;" />

  <!-- Footer Links & Copyright -->
  <div style="font-size: 12px; line-height: 18px; color: #999999;">
    <p style="margin: 0 0 12px 0;">
      This is an automated operational notification message from Piki Food.
    </p>
    <p style="margin: 0;">
      &copy; ${new Date().getFullYear()} Piki Food Inc. All rights reserved.
    </p>
  </div>

</div>
  `;
}
