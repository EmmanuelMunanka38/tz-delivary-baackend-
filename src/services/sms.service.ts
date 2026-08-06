import axios from 'axios';
import config from '../config';

function toInternationalFormat(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) {
    return '+255' + digits.slice(1);
  }
  if (digits.startsWith('255') && digits.length === 12) {
    return '+' + digits;
  }
  if (digits.startsWith('7') && digits.length === 9) {
    return '+255' + digits; 
  }
  return '+' + digits;
}

function getApiUrl(): string {
  const username = config.sms.username?.toLowerCase();
  if (username === 'sandbox') {
    return 'https://api.sandbox.africastalking.com/version1/messaging';
  }
  return 'https://api.africastalking.com/version1/messaging';
}

export const sendOtpSms = async (to: string, otp: string): Promise<void> => {
  const { apiKey, username, from } = config.sms;
  if (!apiKey || !username) {
    console.log(`[SMS] [DEV] OTP for ${toInternationalFormat(to)}: ${otp}`);
    return;
  }

  const internationalNumber = toInternationalFormat(to);
  const url = getApiUrl();

  try {
    const response = await axios.post(
      url,
      new URLSearchParams({
        username,
        to: internationalNumber,
        message: `Your Piki Food verification code is: ${otp}. It expires in 5 minutes.`,
        from: from || 'PIKI',
      }).toString(),
      {
        headers: {
          apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10000,
      },
    );

    console.log(`[SMS] OTP sent to ${internationalNumber}:`, JSON.stringify(response.data));
  } catch (error: any) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    console.error(`[SMS] Failed (${status}): ${data || error?.message}`);

    if (status === 401) {
      console.error('[SMS] Authentication failed. Check AT_USERNAME and AT_API_KEY in .env');
      console.error(`[SMS]   Username: ${username}`);
      //console.error(`[SMS]   API Key: ${apiKey.substring(0, 10)}...`); => this exposed api_key (bug fixed here )
      if (config.isDev && apiKey){
        const masked = apiKey.replace(/.(?=.{4})/g, '*');
          console.error('[SMS]   API Key (masked):', masked);
      }
      console.error('[SMS]   Tip: For sandbox, username must be "sandbox" and API key from sandbox.africastalking.com');
    }
    if (config.isDev) console.log(`[SMS] [DEV] OTP for ${internationalNumber}: ${otp}`); // fixed here 
  }
};
