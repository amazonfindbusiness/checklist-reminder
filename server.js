const express = require('express');
const cron    = require('node-cron');
const fetch   = require('node-fetch');
const cors    = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ── Konfiguration ──────────────────────────────────
const EMAILJS_SERVICE_ID  = 'service_idp1038';
const EMAILJS_TEMPLATE_ID = 'template_j5atf0h';
const EMAILJS_PUBLIC_KEY  = 'f9RvnxLharjdw4K8l';
const REMINDER_EMAIL      = 'amazonfindbusiness@gmail.com';
const PORT                = process.env.PORT || 3000;
// ───────────────────────────────────────────────────

// Aktueller Status der Checkliste (im Speicher)
let checklistState = {
  date: null,
  total: 0,
  done: 0,
  openItems: [],
  lastUpdate: null,
};

// ── Endpunkt: Checkliste sendet ihren Status ────────
// POST /status
// Body: { date, total, done, openItems: ["Task A", "Task B"] }
app.post('/status', (req, res) => {
  const { date, total, done, openItems } = req.body;
  if (!date || total === undefined || done === undefined) {
    return res.status(400).json({ error: 'Fehlende Felder: date, total, done erforderlich.' });
  }
  checklistState = {
    date,
    total: Number(total),
    done:  Number(done),
    openItems: openItems || [],
    lastUpdate: new Date().toISOString(),
  };
  console.log(`[${new Date().toLocaleTimeString('de-DE')}] Status aktualisiert: ${done}/${total} erledigt für ${date}`);
  res.json({ ok: true, received: checklistState });
});

// ── Endpunkt: aktuellen Status abrufen ─────────────
app.get('/status', (req, res) => {
  res.json(checklistState);
});

// ── Endpunkt: Erinnerung manuell auslösen ──────────
app.post('/trigger', async (req, res) => {
  const result = await checkAndSendReminder(true);
  res.json(result);
});

// ── Erinnerungslogik ────────────────────────────────
async function checkAndSendReminder(manual = false) {
  const today = todayStr();

  // Falls kein Status für heute vorhanden
  if (checklistState.date !== today) {
    const msg = `Kein Status für heute (${today}) vorhanden. Checkliste war heute nicht geöffnet.`;
    console.log(msg);
    // Trotzdem Mail senden – Checkliste war nicht geöffnet
    return await sendEmail({
      openItems: ['(Checkliste wurde heute nicht geöffnet)'],
      openCount: '?',
      totalCount: '?',
      today,
    });
  }

  if (checklistState.done >= checklistState.total && checklistState.total > 0) {
    const msg = `✅ Alle ${checklistState.total} Module erledigt – keine Erinnerung.`;
    console.log(msg);
    return { sent: false, reason: msg };
  }

  return await sendEmail({
    openItems: checklistState.openItems,
    openCount: checklistState.total - checklistState.done,
    totalCount: checklistState.total,
    today,
  });
}

async function sendEmail({ openItems, openCount, totalCount, today }) {
  const dateLabel = new Date().toLocaleDateString('de-DE', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
  });

  const openItemsText = Array.isArray(openItems) && openItems.length > 0
    ? openItems.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(keine Details verfügbar)';

  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id:  EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id:     EMAILJS_PUBLIC_KEY,
        template_params: {
          to_email:    REMINDER_EMAIL,
          to_name:     'amazonfindbusiness',
          date:        dateLabel,
          open_items:  openItemsText,
          open_count:  String(openCount),
          total_count: String(totalCount),
        },
      }),
    });

    const text = await response.text();
    if (response.ok) {
      console.log(`📧 Erinnerungsmail gesendet: ${openCount}/${totalCount} offen`);
      return { sent: true, openCount, totalCount };
    } else {
      console.error('EmailJS Fehler:', text);
      return { sent: false, error: text };
    }
  } catch (err) {
    console.error('Fetch-Fehler:', err.message);
    return { sent: false, error: err.message };
  }
}

// ── Cron: täglich um 22:30 (Europe/Berlin) ─────────
cron.schedule('30 22 * * *', () => {
  console.log(`[22:30] Erinnerungsprüfung gestartet...`);
  checkAndSendReminder();
}, { timezone: 'Europe/Berlin' });

// ── Hilfsfunktionen ─────────────────────────────────
function pad(n) { return n.toString().padStart(2, '0'); }
function todayStr() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Health Check ────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    reminderTime: '22:30 Europe/Berlin',
    currentState: checklistState,
  });
});

app.listen(PORT, () => {
  console.log(`✅ Reminder-Server läuft auf Port ${PORT}`);
  console.log(`   Erinnerung: täglich um 22:30 (Europe/Berlin)`);
  console.log(`   Empfänger:  ${REMINDER_EMAIL}`);
});
