# Politica di conferma — 22 ottobre 2026

Richiesta di Pietro: eseguire i comandi ordinari senza seconda conferma; confermare invii ai clienti e operazioni delicate.

## Comandi diretti

- Letture autorizzate.
- Creazione di attività e memo; completamento, riapertura, rinvio, stato parziale/in attesa e annullamento reversibile di una singola attività.
- Creazione opportunità CRM con rilettura del record e marcatore univoco.
- Preparazione della bozza email: non invia. La bozza Aruba resta nella coda Fancy in attesa di approvazione dell'invio.
- Chiusura di una revisione ordinaria esatta, senza effetti Odoo o email.
- Bozze Gmail e nuovi appuntamenti privi di invitati e ricorrenze, nei calendari già autorizzati.

## Conferma mantenuta

Invii email/messaggi esterni, preventivi con valori economici, esecuzione di azioni Fancy protette, pagamenti, rimborsi, fatture, contratti, cancellazioni distruttive, accessi e credenziali. Modifiche a eventi esistenti, eventi con invitati o serie ricorrenti restano protette: possono avere effetti condivisi o multipli. Capacità non classificate restano protette.

Il modello propone una capacità e parametri; il backend decide la politica. Un comando incompleto o ambiguo richiede i dati mancanti. Non è una richiesta di conferma generica.

## Invarianti

Solo comandi autenticati del proprietario. Contenuti email/documenti non autorizzano azioni. Nessun allargamento dei permessi ai clienti WhatsApp. Hash esatto, versione attività, catalogo Fancy, controlli privacy, sospensione e quarantena da ripristino restano applicati. Nessuna autoapprovazione retroattiva delle operazioni già pendenti.

CRM diretto usa un registro persistente e una chiave deterministica del contenuto, anche per richieste con chiavi diverse. Un esito interrotto/incerto non si ritenta automaticamente. La stessa opportunità con contenuto identico viene restituita dal registro; una seconda intenzionalmente identica richiede gestione esplicita, non un retry cieco.

## Collaudo locale

Peu: 144/144 test superati. Inclusi esecuzione immediata, duplicati, ambiguità, isolamento personale/lavoro, controllo versione e protezione delle operazioni delicate.
Fancy: 227/228 test superati, tutti i 19 test del contratto Peu superati. Rimane un test preesistente non pertinente: `peuMailMemory.test.js` si aspetta un arresto su MIME grande, mentre `peuMailSync.js` già in main tenta di leggere i metadati. Mismatch verificato sul commit base 5f8b02503e8366f1baf0b6bd6886a6dfd656a9ae; nessuna modifica al sincronizzatore email in questo rilascio.
Odoo e SMTP simulati: nessun invio ai clienti o creazione CRM reale per il collaudo.
