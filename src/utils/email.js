const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '465', 10),
      secure: process.env.SMTP_SECURE !== 'false', // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

const FROM = process.env.EMAIL_FROM || '"UEFN с нуля" <noreply@uefn-s-nulya.ru>';

// ─────────────────────────────────────────────────────────────────────────────

async function sendOtpEmail(email, code, purpose) {
  const subjects = {
    verify_email:     'Подтверждение email',
    login:            'Код входа',
    reset_password:   'Сброс пароля',
  };

  const subject = subjects[purpose] || 'Код подтверждения';

  const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: sans-serif; background:#0F1317; color:#E5EAF0; margin:0; padding:0; }
    .wrap { max-width:520px; margin:40px auto; background:#181D23; border-radius:16px; overflow:hidden; }
    .top  { background:linear-gradient(135deg,#3BCFFE,#6C6FFF); padding:32px; text-align:center; }
    .top h1 { color:#fff; font-size:22px; margin:0; }
    .body { padding:32px; }
    .code { font-size:40px; font-weight:700; letter-spacing:12px; color:#3BCFFE;
            background:#0F1317; border-radius:12px; text-align:center; padding:20px; margin:24px 0; }
    .note { color:#8A96A3; font-size:13px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top"><h1>UEFN с нуля</h1></div>
    <div class="body">
      <p>Ваш код подтверждения:</p>
      <div class="code">${code}</div>
      <p class="note">Код действителен ${process.env.OTP_EXPIRES_MINUTES || 10} минут. Не передавайте его никому.</p>
    </div>
  </div>
</body>
</html>`;

  await getTransporter().sendMail({
    from: FROM,
    to:   email,
    subject,
    html,
    text: `Ваш код подтверждения: ${code}\nДействителен ${process.env.OTP_EXPIRES_MINUTES || 10} минут.`,
  });
}

async function sendWelcomeEmail(email, name) {
  const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: sans-serif; background:#0F1317; color:#E5EAF0; margin:0; }
    .wrap { max-width:520px; margin:40px auto; background:#181D23; border-radius:16px; overflow:hidden; }
    .top  { background:linear-gradient(135deg,#3BCFFE,#6C6FFF); padding:32px; text-align:center; }
    .top h1 { color:#fff; font-size:22px; margin:0; }
    .body { padding:32px; }
    .btn  { display:inline-block; background:linear-gradient(135deg,#3BCFFE,#6C6FFF);
            color:#fff; text-decoration:none; padding:14px 32px; border-radius:10px;
            font-weight:600; margin-top:16px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top"><h1>Добро пожаловать!</h1></div>
    <div class="body">
      <p>Привет, ${name || 'друг'}! 👋</p>
      <p>Ваш аккаунт на платформе <strong>UEFN с нуля</strong> успешно создан.</p>
      <p>Начните своё путешествие в мир разработки игр на Fortnite прямо сейчас.</p>
      <a href="${process.env.FRONTEND_URL || 'https://uefn-s-nulya.ru'}/course.html" class="btn">Перейти к курсу →</a>
    </div>
  </div>
</body>
</html>`;

  await getTransporter().sendMail({
    from: FROM,
    to:   email,
    subject: 'Добро пожаловать в UEFN с нуля!',
    html,
    text: `Привет, ${name || 'друг'}! Ваш аккаунт успешно создан. Перейдите к курсу: ${process.env.FRONTEND_URL}/course.html`,
  });
}

module.exports = { sendOtpEmail, sendWelcomeEmail };
