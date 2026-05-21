const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '465', 10),
      secure: process.env.SMTP_SECURE !== 'false',
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
    verify_email:   'Подтверждение email',
    login:          'Код входа',
    reset_password: 'Сброс пароля',
  };

  const subject = subjects[purpose] || 'Код подтверждения';

  const html = `
<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${subject}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; padding:0; background-color:#0F1317 !important; }
    /* Force dark on ALL email clients */
    [data-ogsc] body, [data-ogsb] body { background-color:#0F1317 !important; }
    @media (prefers-color-scheme: dark) {
      body { background-color:#0F1317 !important; }
      .outer { background-color:#0F1317 !important; }
      .card  { background-color:#131920 !important; border-color:#1e2730 !important; }
      .code-cell { background-color:#0F1317 !important; }
      .note-cell { background-color:#161d24 !important; }
      .logo-cell { background-color:#131920 !important; }
      .white { color:#ffffff !important; }
      .muted { color:#8a96a3 !important; }
      .dim   { color:#4a5568 !important; }
      .cyan  { color:#3BCFFE !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0F1317;-webkit-font-smoothing:antialiased;" bgcolor="#0F1317">

<table class="outer" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#0F1317;padding:40px 16px;" bgcolor="#0F1317">
  <tr>
    <td align="center">
      <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">

        <!-- LOGO -->
        <tr>
          <td align="center" style="padding-bottom:24px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="logo-cell" bgcolor="#131920"
                    style="background-color:#131920;border:1px solid #1e2730;border-radius:100px;padding:10px 22px;">
                  <span class="white"
                        style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:800;
                               letter-spacing:0.01em;color:#ffffff;white-space:nowrap;">
                    UEFN с нуля
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CARD -->
        <tr>
          <td class="card" bgcolor="#131920"
              style="background-color:#131920;border:1px solid #1e2730;border-radius:24px;overflow:hidden;">

            <!-- GRADIENT TOP LINE — solid colors for email compat -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="50%" height="4" bgcolor="#0166C3"
                    style="background-color:#0166C3;font-size:0;line-height:0;">&nbsp;</td>
                <td width="50%" height="4" bgcolor="#3BCFFE"
                    style="background-color:#3BCFFE;font-size:0;line-height:0;">&nbsp;</td>
              </tr>
            </table>

            <!-- HEADER -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#131920" style="background-color:#131920;padding:40px 40px 16px;">
                  <p class="dim"
                     style="margin:0 0 8px;font-family:'Helvetica Neue',Arial,sans-serif;
                            font-size:11px;font-weight:600;color:#4a5568;
                            text-transform:uppercase;letter-spacing:0.12em;">
                    Код подтверждения
                  </p>
                  <p class="white"
                     style="margin:0;font-family:'Helvetica Neue',Arial,sans-serif;
                            font-size:22px;font-weight:700;color:#ffffff;line-height:1.25;">
                    ${subject}
                  </p>
                </td>
              </tr>
            </table>

            <!-- CODE BLOCK -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#131920" style="background-color:#131920;padding:8px 40px 32px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td class="code-cell" bgcolor="#0F1317"
                          style="background-color:#0F1317;border:1px solid #1a3a4a;
                                 border-radius:16px;padding:28px 20px;text-align:center;">
                        <span class="cyan"
                              style="font-family:'Courier New',Courier,monospace;
                                     font-size:44px;font-weight:700;letter-spacing:14px;
                                     color:#3BCFFE;display:block;line-height:1;">
                          ${code}
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- DIVIDER -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#131920" style="background-color:#131920;padding:0 40px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td height="1" bgcolor="#1e2730"
                          style="background-color:#1e2730;font-size:0;line-height:0;">&nbsp;</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- NOTE -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#131920" style="background-color:#131920;padding:24px 40px 40px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td class="note-cell" bgcolor="#161d24"
                          style="background-color:#161d24;border:1px solid #1e2730;
                                 border-radius:12px;padding:16px 20px;">
                        <p class="muted"
                           style="margin:0;font-family:'Helvetica Neue',Arial,sans-serif;
                                  font-size:13px;color:#8a96a3;line-height:1.65;">
                          ⏱ Код действителен
                          <strong style="color:#b0bec5;">${process.env.OTP_EXPIRES_MINUTES || 10} минут</strong>.<br>
                          Не передавайте его никому — команда проекта никогда не запрашивает коды.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:28px 0 0;text-align:center;">
            <p style="margin:0;font-family:'Helvetica Neue',Arial,sans-serif;
                      font-size:12px;color:#2d3748;line-height:1.6;">
              © 2025–2026 UEFN с нуля &nbsp;·&nbsp; Это автоматическое письмо, не отвечайте на него
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

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

// ─────────────────────────────────────────────────────────────────────────────

async function sendWelcomeEmail(email, name) {
  const html = `
<!DOCTYPE html>
<html lang="ru" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>Добро пожаловать в UEFN с нуля!</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; padding:0; background-color:#0F1317 !important; }
    @media (prefers-color-scheme: dark) {
      body { background-color:#0F1317 !important; }
      .outer { background-color:#0F1317 !important; }
      .card  { background-color:#131920 !important; border-color:#1e2730 !important; }
      .logo-cell { background-color:#131920 !important; }
      .note-cell { background-color:#161d24 !important; }
      .white { color:#ffffff !important; }
      .muted { color:#8a96a3 !important; }
      .dim   { color:#4a5568 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0F1317;-webkit-font-smoothing:antialiased;" bgcolor="#0F1317">

<table class="outer" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#0F1317;padding:40px 16px;" bgcolor="#0F1317">
  <tr>
    <td align="center">
      <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">

        <!-- LOGO -->
        <tr>
          <td align="center" style="padding-bottom:24px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="logo-cell" bgcolor="#131920"
                    style="background-color:#131920;border:1px solid #1e2730;border-radius:100px;padding:10px 22px;">
                  <span class="white"
                        style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:800;
                               letter-spacing:0.01em;color:#ffffff;white-space:nowrap;">
                    UEFN с нуля
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CARD -->
        <tr>
          <td class="card" bgcolor="#131920"
              style="background-color:#131920;border:1px solid #1e2730;border-radius:24px;overflow:hidden;">

            <!-- GRADIENT TOP LINE -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="50%" height="4" bgcolor="#0166C3"
                    style="background-color:#0166C3;font-size:0;line-height:0;">&nbsp;</td>
                <td width="50%" height="4" bgcolor="#3BCFFE"
                    style="background-color:#3BCFFE;font-size:0;line-height:0;">&nbsp;</td>
              </tr>
            </table>

            <!-- HERO -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#131920" style="background-color:#131920;padding:40px 40px 28px;">
                  <p class="dim"
                     style="margin:0 0 14px;font-family:'Helvetica Neue',Arial,sans-serif;
                            font-size:11px;font-weight:600;color:#4a5568;
                            text-transform:uppercase;letter-spacing:0.12em;">
                    Аккаунт создан
                  </p>
                  <p class="white"
                     style="margin:0 0 14px;font-family:'Helvetica Neue',Arial,sans-serif;
                            font-size:26px;font-weight:700;color:#ffffff;line-height:1.2;">
                    Привет, ${name || 'друг'}!
                  </p>
                  <p class="muted"
                     style="margin:0;font-family:'Helvetica Neue',Arial,sans-serif;
                            font-size:15px;color:#8a96a3;line-height:1.7;">
                    Твой аккаунт на платформе
                    <strong style="color:#ffffff;">UEFN с нуля</strong>
                    успешно создан. Добро пожаловать — начинаем разбираться в разработке карт для Fortnite.
                  </p>
                </td>
              </tr>
            </table>

            <!-- DIVIDER -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#131920" style="background-color:#131920;padding:0 40px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td height="1" bgcolor="#1e2730"
                          style="background-color:#1e2730;font-size:0;line-height:0;">&nbsp;</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#131920" style="background-color:#131920;padding:32px 40px 40px;">
                  <p class="muted"
                     style="margin:0 0 20px;font-family:'Helvetica Neue',Arial,sans-serif;
                            font-size:14px;color:#8a96a3;">
                    Твои материалы и уроки ждут в личном кабинете:
                  </p>
                  <table cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <!-- Left half button -->
                      <td bgcolor="#0166C3"
                          style="background-color:#0166C3;border-radius:100px 0 0 100px;padding:0;">
                        <a href="${process.env.FRONTEND_URL || 'https://uefn-s-nulya.ru'}/course.html"
                           style="display:inline-block;padding:14px 0 14px 28px;
                                  font-family:'Helvetica Neue',Arial,sans-serif;
                                  font-size:15px;font-weight:600;color:#ffffff;
                                  text-decoration:none;white-space:nowrap;">
                          Перейти к курсу
                        </a>
                      </td>
                      <!-- Right half button -->
                      <td bgcolor="#3BCFFE"
                          style="background-color:#3BCFFE;border-radius:0 100px 100px 0;padding:0;">
                        <a href="${process.env.FRONTEND_URL || 'https://uefn-s-nulya.ru'}/course.html"
                           style="display:inline-block;padding:14px 28px 14px 0;
                                  font-family:'Helvetica Neue',Arial,sans-serif;
                                  font-size:15px;font-weight:600;color:#ffffff;
                                  text-decoration:none;white-space:nowrap;">
                          &nbsp;→
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="padding:28px 0 0;text-align:center;">
            <p style="margin:0;font-family:'Helvetica Neue',Arial,sans-serif;
                      font-size:12px;color:#2d3748;line-height:1.6;">
              © 2025–2026 UEFN с нуля &nbsp;·&nbsp; Это автоматическое письмо, не отвечайте на него
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

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
