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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0F1317;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F1317;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

          <!-- LOGO -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#131920;border:1px solid rgba(255,255,255,0.08);border-radius:100px;padding:10px 22px;">
                    <span style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:0.01em;color:#ffffff;white-space:nowrap;">UEFN с нуля</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CARD -->
          <tr>
            <td style="background:#131920;border:1px solid rgba(255,255,255,0.08);border-radius:24px;overflow:hidden;">

              <!-- TOP GRADIENT BAR -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#0166C3 0%,#3BCFFE 100%);height:4px;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- BODY -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:40px 40px 16px;">
                    <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.1em;">Код подтверждения</p>
                    <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;">${subject}</p>
                  </td>
                </tr>

                <!-- CODE BLOCK -->
                <tr>
                  <td style="padding:8px 40px 32px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#0F1317;border:1px solid rgba(59,207,254,0.2);border-radius:16px;padding:28px 20px;text-align:center;">
                          <span style="font-family:'Courier New',Courier,monospace;font-size:48px;font-weight:700;letter-spacing:16px;color:#3BCFFE;display:block;line-height:1;">${code}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- DIVIDER -->
                <tr>
                  <td style="padding:0 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr><td style="border-top:1px solid rgba(255,255,255,0.06);font-size:0;line-height:0;">&nbsp;</td></tr>
                    </table>
                  </td>
                </tr>

                <!-- NOTE -->
                <tr>
                  <td style="padding:24px 40px 40px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:16px 20px;">
                          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.45);line-height:1.6;">
                            ⏱ Код действителен <strong style="color:rgba(255,255,255,0.7);">${process.env.OTP_EXPIRES_MINUTES || 10} минут</strong>.<br>
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
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.2);line-height:1.6;">
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

async function sendWelcomeEmail(email, name) {
  const html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Добро пожаловать в UEFN с нуля!</title>
</head>
<body style="margin:0;padding:0;background:#0F1317;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F1317;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

          <!-- LOGO -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#131920;border:1px solid rgba(255,255,255,0.08);border-radius:100px;padding:10px 22px;">
                    <span style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:0.01em;color:#ffffff;white-space:nowrap;">UEFN с нуля</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CARD -->
          <tr>
            <td style="background:#131920;border:1px solid rgba(255,255,255,0.08);border-radius:24px;overflow:hidden;">

              <!-- TOP GRADIENT BAR -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#0166C3 0%,#3BCFFE 100%);height:4px;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- HERO -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:40px 40px 32px;">
                    <p style="margin:0 0 16px;font-size:12px;font-weight:600;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.1em;">Аккаунт создан</p>
                    <p style="margin:0 0 12px;font-size:26px;font-weight:700;color:#ffffff;line-height:1.2;">Привет, ${name || 'друг'}!</p>
                    <p style="margin:0;font-size:15px;color:rgba(255,255,255,0.55);line-height:1.7;">
                      Твой аккаунт на платформе <strong style="color:#ffffff;">UEFN с нуля</strong> успешно создан. Добро пожаловать — начинаем разбираться в разработке карт для Fortnite.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- DIVIDER -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:0 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr><td style="border-top:1px solid rgba(255,255,255,0.06);font-size:0;line-height:0;">&nbsp;</td></tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:32px 40px 40px;">
                    <p style="margin:0 0 20px;font-size:14px;color:rgba(255,255,255,0.45);">Твои материалы и уроки ждут в личном кабинете:</p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:linear-gradient(135deg,#0166C3 0%,#3BCFFE 100%);border-radius:100px;">
                          <a href="${process.env.FRONTEND_URL || 'https://uefn-s-nulya.ru'}/course.html"
                             style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;white-space:nowrap;">
                            Перейти к курсу →
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
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.2);line-height:1.6;">
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
