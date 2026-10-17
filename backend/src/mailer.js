// backend/src/mailer.js — письма (сброс пароля) через SMTP (Фаза A, заход 48)
// SMTP не настроен (dev/тесты) — письмо логируется, ссылка возвращается в
// теле ответа НЕ должна; в тестах токен читается прямо из БД.
import nodemailer from 'nodemailer';
import { CONFIG } from './config.js';

let transport = null;
function getTransport() {
  if (!CONFIG.SMTP_HOST) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: CONFIG.SMTP_HOST,
      port: CONFIG.SMTP_PORT,
      secure: CONFIG.SMTP_PORT === 465,
      auth: { user: CONFIG.SMTP_USER, pass: CONFIG.SMTP_PASS },
    });
  }
  return transport;
}

export async function sendPasswordReset(email, token) {
  const link = `${CONFIG.PUBLIC_URL}/#reset=${token}`;
  const text = `Здравствуйте!\n\nКто-то запросил сброс пароля SampleHelp для ${email}.\nСсылка действительна 1 час: ${link}\n\nЕсли это не вы — просто проигнорируйте письмо.`;
  const t = getTransport();
  if (!t) {
    console.info(`[mailer] SMTP не настроен; сброс для ${email}: ${link}`);
    return { delivered: false, link };
  }
  await t.sendMail({ from: CONFIG.MAIL_FROM, to: email, subject: 'SampleHelp: сброс пароля', text });
  return { delivered: true, link: null };
}
