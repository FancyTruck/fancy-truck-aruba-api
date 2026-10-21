# Fondazioni operative — 21 ottobre 2026

## Consultazione

Aprire `/briefing` e usare REVIEW_READ_TOKEN. La chiave rimane soltanto nella memoria della pagina. Sono mostrati conteggi Odoo, ultime 20 opportunità/preventivi, preventivi scaduti, casi da classificare e stato delle connessioni. Errori e dati parziali sono espliciti. Nessuna scrittura o invio.

## Ruoli

REVIEW_READ_TOKEN: briefing e consultazione revisioni.
REVIEW_WRITE_TOKEN: anche chiusura revisioni.
AUTOMATION_TOKEN: avvio ciclo e briefing, nessuna approvazione.
APPROVER_TOKEN: elenco azioni, comando e conferma.
EXECUTOR_TOKEN: esecuzione soltanto di azioni già approvate.
API_TOKEN: amministrazione e connettori preesistenti; con SEPARATE_APPROVAL_ROLES=true non può approvare né eseguire azioni.

Le chiavi devono essere diverse. Conservare quelle di approvazione/esecuzione sotto controllo di Pietro, non nel connettore automatico. La separazione delle chiavi non equivale a un'identità nominativa con MFA. La doppia conferma resta una procedura applicativa; il requisito MFA va trattato separatamente.

## Backup esterno gratuito predisposto

Destinazione suggerita: bucket B2 privato e dedicato; primi 10 GB gratuiti secondo il listino verificato. Preferire regione UE. Creare chiave applicativa limitata al bucket e al prefisso `fancy-ai-state-v1/`, con lettura, elenco, scrittura e cancellazione degli oggetti backup. Non concedere amministrazione account.

Configurare su Render: BACKUP_S3_ENDPOINT (HTTPS), BACKUP_S3_REGION, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY, BACKUP_ENCRYPTION_KEY (64 cifre esadecimali), EXTERNAL_BACKUP_ENABLED=true. La chiave di cifratura deve essere conservata anche fuori da Render e dal bucket: senza di essa il ripristino è impossibile.

Un backup al giorno durante i cicli operativi. AES-256-GCM, compressione, download e decifratura di controllo prima del successo. Nessuna cancellazione di vecchie copie prima della verifica della nuova. Conservazione 30 giorni, limite prudenziale 1 GB nel prefisso e 32 MB di stato per copia. Richiede bucket dedicato: il limite non copre altri dati, versioni create da altri strumenti o il resto dell'account. Nessuna promessa di costo zero oltre i limiti del provider.

Il backup contiene lo stato di Fancy AI, non il database/allegati Odoo, le caselle email o le credenziali Render. Questi sistemi hanno procedure di recupero distinte.

Ripristino: `node scripts/restore-external-backup.js CHIAVE_OGGETTO NUOVO_FILE`. Rifiuta sovrascritture. Prima di sostituire lo stato operativo, fermare i cicli, verificare la copia e riconciliare eventuali operazioni avvenute dopo il backup.

## Connessione ChatGPT–Odoo

La versione13 del sito connettore corrisponde al commit6fbef4e27fdf622949c2b53ba9ab0009fbb8109f. Il percorso OAuth personalizzato esaminato emette access token di 30 giorni e accetta solo authorization_code: nessun refresh_token grant. Il collegamento nativo Sites è distinto e il rinnovo effettivo non è stato dimostrato. Non dichiarare chiusa questa verifica con la sola health Odoo positiva. La chiave API Odoo su Render è già stata sostituita con Fancy AI e la vecchia revoca è stata confermata dall'utente.
