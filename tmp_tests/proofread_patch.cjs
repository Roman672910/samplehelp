// One-off proofread patch for en/de dictionaries (approved: Variant A).
// Usage: node tmp_tests/proofread_patch.cjs
const fs = require('fs');

const EN = {
  'auth.enter_email_first': ['Enter your email in the field above first', 'First enter your email in the field above'],
  'favorites.empty': ['Favorites are empty. Save questions from the feed and prepare answers at your own pace.', 'No favorites yet. Save questions from the feed and prepare answers at your own pace.'],
  'ask.category_hint': ['Optional: the exact sound type (Bass, Pad\u2026) will be defined by answerers', 'Optional: the exact sound type (Bass, Pad\u2026) will be determined by answerers'],
  'marketplace.coming_soon': ["The preset marketplace is under construction. Soon you'll be able to sell your packs with a platform commission.", "The preset marketplace is under construction. Soon you'll be able to sell your packs here, and the platform will take a commission."],
  'notifications.mark_all_read': ['Mark all read', 'Mark all as read'],
  'profile.showcase_empty': ['No tracks yet \u2014 add up to three of your works so your profile makes sound', 'No tracks yet \u2014 add up to three of your works to give your profile its own sound'],
  'question.answers_closed': ['Question solved \u2014 new answers are closed', 'Question solved \u2014 no new answers are accepted'],
  'question.solved_badge_hint': ['By timer, the question content will be deleted, leaving an archive page', 'When the timer expires, the question content is deleted \u2014 an archive page remains'],
  'question.unresolve_confirm': ['The question will become open again: answers will be accepted and the deletion timer cancelled. Reputation already awarded to the helper is kept. Continue?', 'The question will become open again: answers will be accepted and the deletion timer will be cancelled. Reputation already awarded to the helper will be kept. Continue?'],
  'trimmer.hint_ws': ['Drag the edges of the copper region to trim the excess', 'Drag the edges of the copper-colored area to trim the excess'],
  'trimmer.zoom_hint': ['Wheel \u2014 pan, Ctrl+wheel \u2014 zoom at cursor, \u2212/\uFF0B buttons also zoom. Selection length \u2014 up to {n} sec.', 'Mouse wheel \u2014 pan, Ctrl+wheel \u2014 zoom at cursor, \u2212/\uFF0B buttons also zoom. Selection length \u2014 up to {n} sec.'],
};

const DE = {
  'answer.difficulty': ['Schwierigkeit zum Nachbauen', 'Schwierigkeit des Nachbaus'],
  'ask.title_ph': ['Wie mache ich diesen knurrenden Bass?', 'Wie baue ich diesen Growl-Bass?'],
  'auth.enter_email_first': ['Gib zuerst deine E-Mail oben ein', 'Gib zuerst deine E-Mail im Feld oben ein'],
  'favorites.empty': ['Favoriten sind leer. Speichere Fragen aus dem Feed und bereite Antworten in deinem Tempo vor.', 'Deine Favoriten sind leer. Speichere Fragen aus dem Feed und bereite Antworten in deinem Tempo vor.'],
  'feed.difficulty_intermediate': ['Mittel', 'Mittelstufe'],
  'feed.difficulty_advanced': ['Fortgeschritten', 'Fortgeschrittene'],
  'notifications.type_like': ['gef\u00e4llt', 'mag'],
  'notifications.type_new_question_tag': ['Neue Frage im Tag', 'Neue Frage zum Tag'],
  'notifications.type_reminder': ['Ist Ihre Frage gel\u00f6st? Sehen Sie die Antworten an und markieren Sie die beste:', 'Ist deine Frage gel\u00f6st? Sieh dir die Antworten an und markiere die beste:'],
  'profile.arsenal_hint': ['Markiere deine Tools \u2014 Antwortende passen Tipps an dein Arsenal an. Fehlt etwas? \u00dcber \u201e+\u201c erg\u00e4nzen.', 'Markiere deine Tools \u2014 Antwortende passen Tipps an dein Arsenal an. Fehlt etwas? F\u00fcge es \u00fcber \u201e+\u201c hinzu.'],
  'profile.crop_hint': ['Bild verschieben und Zoom anpassen \u2014 der Bereich im kupfernen Kreis wird dein Avatar.', 'Bild verschieben und Zoom anpassen \u2014 der Bereich im kupferfarbenen Kreis wird dein Avatar.'],
  'profile.following': ['Folgst du', 'Du folgst'],
  'question.ab_hint': ['A/B oder Leertaste \u2014 wechseln und play/pause', 'A/B oder Leertaste \u2014 wechseln und Play/Pause'],
  'question.answers_closed': ['Frage gel\u00f6st \u2014 neue Antworten sind geschlossen', 'Frage gel\u00f6st \u2014 keine neuen Antworten mehr m\u00f6glich'],
  'question.comment_links_banned': ['Links sind in Kommentaren nicht erlaubt \u2014 f\u00fcgen Sie sie einer Antwort \u00fcber das \ud83d\udd17-Widget hinzu', 'Links sind in Kommentaren nicht erlaubt \u2014 f\u00fcge sie \u00fcber das \ud83d\udd17-Widget einer Antwort hinzu'],
  'question.purged_note': ['Sieben Tage nach der L\u00f6sungsmarkierung wurden Frage, Antworten, Kommentare und Audio gel\u00f6scht. Bewertungen und Statistiken bleiben f\u00fcr immer erhalten. Alte Links f\u00fchren auf diese Seite.', 'Sieben Tage nach der L\u00f6sungsmarkierung wurden Frage, Antworten, Kommentare und Audiodateien gel\u00f6scht. Bewertungen und Statistiken bleiben f\u00fcr immer erhalten. Alte Links f\u00fchren auf diese Seite.'],
  'question.solved_badge_hint': ['Laut Timer wird der Inhalt der Frage gel\u00f6scht, eine Archivseite bleibt', 'Nach Ablauf des Timers wird der Inhalt der Frage gel\u00f6scht \u2014 eine Archivseite bleibt erhalten'],
  'question.unresolve_confirm': ['Die Frage wird wieder offen: Antworten sind wieder m\u00f6glich, der L\u00f6sch-Timer wird aufgehoben. Bereits vergebenes Reputation bleibt erhalten. Fortfahren?', 'Die Frage wird wieder offen: Antworten sind wieder m\u00f6glich, der L\u00f6sch-Timer wird aufgehoben. Bereits vergebene Reputation bleibt erhalten. Fortfahren?'],
  'trimmer.marker_note_ph': ['Notiz: \u201edieses Knurren\u201c', 'Notiz: \u201edieser Growl\u201c'],
  'trimmer.zoom_hint': ['Rad \u2014 Verschieben, Strg+Rad \u2014 Zoom am Cursor, \u2212/\uFF0B zoomen ebenfalls. Auswahl maximal {n} Sek.', 'Mausrad \u2014 Verschieben, Strg+Mausrad \u2014 Zoom am Cursor, \u2212/\uFF0B zoomen ebenfalls. Auswahl maximal {n} Sek.'],
};

function get(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function set(obj, path, v) { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], obj)[last] = v; }

let errors = 0, changed = 0;
for (const [loc, map] of [['en', EN], ['de', DE]]) {
  const file = 'public/locales/' + loc + '.json';
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [key, [oldV, newV]] of Object.entries(map)) {
    const cur = get(obj, key);
    if (cur !== oldV) { console.error('MISMATCH', loc, key, '\n  expected:', JSON.stringify(oldV), '\n  actual:  ', JSON.stringify(cur)); errors++; continue; }
    set(obj, key, newV);
    changed++;
    console.log('OK', loc, key, '->', JSON.stringify(newV));
  }
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
console.log('changed:', changed, 'errors:', errors);
process.exit(errors ? 1 : 0);