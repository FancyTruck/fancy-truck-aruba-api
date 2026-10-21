# Backup coordinato Fancy / registro Peu — formato 2

## Ambito

Una copia cifra insieme lo stato JSON Fancy e **tutto** `peu-aruba.sqlite`
(cache, cursori, richieste ed effetti). Non è un backup del database separato
del servizio Peu AI, né degli allegati non conservati nella cache.
Riutilizza bucket, chiave AES-256-GCM, credenziali e prefisso
`fancy-ai-state-v1/` esistenti; il suffisso nuovo è `.bundle.enc`.
Nessuna credenziale amministrativa viene distribuita a Peu.

## Coerenza e verifica

- Il servizio ha un solo processo proprietario degli archivi. Sono escluse
  richieste API attive, cicli operativi concorrenti e registri `executing`.
  JSON e `VACUUM INTO` SQLite sono catturati senza alcun `await`: nessun callback
  applicativo può modificarli tra le due copie. Non avviare writer esterni o
  processi aggiuntivi sugli stessi file: invaliderebbero questa garanzia.
- Manifest cifrato con identificativo, inizio/fine cattura, nomi fissi,
  dimensioni, SHA-256 e conteggi. Hash e tag GCM verificano l'intera copia.
- Compressione/cifratura, upload, download e decifratura sono in streaming.
  Limiti distinti: JSON 32 MiB, SQLite 1 GiB (dimensione del disco esistente),
  oggetto cifrato 1060 MiB. La quota del bucket di 1 GiB è comunque verificata
  PRIMA dell'upload e può rifiutare un oggetto entro questi limiti tecnici.
  Verifica spazio temporaneo prima della cattura. Superare un limite produce
  allarme, non un backup incompleto né una cancellazione della cache.
- Prima dell'upload sono elencate tutte le versioni sotto il prefisso autorizzato,
  inclusi oggetti nascosti; quota prudenziale invariata 1 GiB. La quota non è
  una garanzia di spazio del fornitore: errori del bucket restano errori.
- Dopo l'upload si scarica l'oggetto reale, confronta SHA-256, decifra ed estrae
  in directory temporanea privata, tramite processo separato con ambiente vuoto
  (nessuna credenziale di servizi esterni). Si verifica `PRAGMA integrity_check`,
  tutte le tabelle, il collegamento effetti/approvazioni e la quarantena.
  Non viene avviato il server ripristinato né importato alcun adattatore SMTP/Odoo.
  La sola chiave di decifratura arriva tramite pipe privata, mai argomenti/log.
- Solo dopo questa prova è registrato `external_backup_verified`, formato 2,
  chiave oggetto, dimensioni, conteggi, data e `restore_writes_blocked:true`.
  I contenuti delle email e le chiavi non sono scritti nei log.
- Copie formato 2 più vecchie di 30 giorni sono eliminate per versione solo
  dopo la prova riuscita. Le copie JSON precedenti restano invariate.
  Se il budget 1 GiB non basta per la conservazione, serve una scelta esplicita
  su capacità/conservazione: nessun aumento di costo o cancellazione anticipata
  è automatico.

## Frequenza e allarmi

Avvio dopo 5 secondi, controllo ogni ora, almeno una copia verificata per giorno
UTC. Funziona fuori dagli orari commerciali e senza avviare cicli CRM/email.
Se una richiesta occupa la finestra di cattura, il tentativo fallisce in sicurezza
e riprova al controllo successivo. Una richiesta interrotta che non termina può
impedire la cattura fino al riavvio: verificare prima eventuali esiti incerti.

`external_backup_alarm` / `BACKUP_NOT_VERIFIED` e stato integrazione ERROR
segnalano errore, spazio insufficiente o cattura non disponibile.
`BACKUP_DISABLED` segnala un servizio Peu avviato senza backup abilitato.
Allarme nei log/diagnostica: **nessun invio WhatsApp/email di allarme** è aggiunto.
Controllare che l'ultimo `external_backup_verified` formato 2 non superi 26 ore;
la disponibilità HTTP non dimostra l'esistenza di un backup.

## Ripristino: esclusivamente nuova directory

Con le credenziali backup fornite tramite ambiente sicuro:

```sh
node scripts/restore-external-backup.js CHIAVE_OGGETTO NUOVA_DIRECTORY
```

Il comando rifiuta destinazioni esistenti. Produce `fancy-truck-state.json`,
`peu-aruba.sqlite`, `manifest.json` e `RECOVERY_REQUIRED.json` (permessi privati).
Ripristinare prima in un ambiente isolato senza credenziali CRM/SMTP e senza
uscita di rete; non sostituire archivi live.

Il JSON e SQLite contengono inoltre marcatori persistenti di quarantena.
L'avvio del backend con anche uno solo dei marcatori impone sola lettura e
disabilita i cicli automatici, indipendentemente da READ_ONLY/AUTOMATION_ENABLED.
Il contratto Peu impone anch'esso la quarantena. Gli effetti conclusi restano
consultabili senza rieseguirli; quelli interrotti diventano `unknown`.

**La quarantena riguarda ogni nuova scrittura**, non solo righe executing:
operazioni riuscite DOPO la copia potrebbero non figurare affatto nel registro.
Prima di riattivare:

1. Individuare intervallo dalla cattura al guasto, log e approvazioni successivi.
2. Riconciliare Odoo tramite identificativi `[AUTO:peu-<action_id>]` / AUTO,
   oggetti e stato effettivo; riconciliare SMTP tramite Message-ID e registri
   del provider. Accettazione SMTP non significa consegna al destinatario.
3. Ricostruire effetti conclusi e chiavi anti-duplicato da prove verificabili;
   revocare/richiedere nuovamente approvazioni incomplete o successive alla copia.
4. Se l'esito non è dimostrabile, mantenere `unknown` e NON reinviare.
5. Ottenere revisione esplicita della riconciliazione e della riattivazione.
   Non esiste un endpoint generico per cancellare la quarantena. I tre marcatori
   non vanno rimossi come semplice risoluzione di un errore di configurazione.

Anche il ripristino JSON formato 1 aggiunge quarantena: non può ripristinare
il nuovo registro. Non dichiararlo un recupero completo.

## Rilascio e rollback

Nessuna migrazione distruttiva del database live. Nuove copie accanto alle
precedenti; lettore legacy conservato. Il rilascio del servizio con disco ha un
breve riavvio. Verificare il commit live, HTTP e prova esterna formato 2.

Se fallisce il backup, non ripristinare produzione: lasciare dati e copie intatti,
segnalare il requisito aperto e correggere accesso/spazio/implementazione.
Un rollback del codice non ripristina i dati e può riattivare il vecchio backup
JSON-only: dichiarare il requisito nuovamente aperto. **Non eseguire vecchio
codice su dati ripristinati**, perché non applica la quarantena nuova.

## Test senza rete e senza invii reali

`node --test test/backupBundle.test.js test/peuContract.test.js`

Include doppio archivio, cache/cursori, effetto concluso con nuova chiave,
effetto successivo alla copia bloccato, esclusione operazioni attive, integrità,
upload/download falliti, parzialità, alterazione, chiave errata, quota/versioni,
conservazione e rifiuto sovrascrittura. SMTP/Odoo nei test sono funzioni sintetiche.

### Capacity and restart reporting

Bundle backups accept `BACKUP_MAX_STORAGE_BYTES` (default 1073741824,
maximum 8000000000) and `BACKUP_RETENTION_DAYS` (default 30, range 1–365).
Changing retention requires an explicit operator decision; deploying this code
alone preserves the existing limits. Shorter retention deletes only expired
managed bundle versions after a replacement has passed isolated verification,
including when verification resumes an interrupted upload. Legacy JSON backups
are unchanged. Capacity includes hidden versions and the newly uploaded copy;
`NEXT_BACKUP_BLOCKED` means the next same-sized copy does not fit. It is an
estimate, not a promise about growth or provider billing. Daily verification
markers retain their original verification timestamp when capacity is refreshed.

On writable server startup, previous RUNNING cycles become INTERRUPTED with an
audit entry. Checkpoints, mail operations and approvals are untouched; the
interrupted cycle is never represented as completed or replayed by this repair.
Read-only and recovery-quarantined starts do not perform this mutation.
