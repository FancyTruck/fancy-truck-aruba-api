# Fancy AI — candidato da collaudare

Questo ramo non è pronto per attivare l'automazione in produzione.

## Verificato localmente

- 108 test superati, inclusi i quattro percorsi eseguiti dalle funzioni effettive del server con risposte Odoo simulate. Nessuna chiamata ai sistemi aziendali o invio reale nei test.
- Richiesta incompleta → stessa pratica → domanda in approvazione → risposta cliente. Le domande superate vengono annullate.
- Evento food: risposta in approvazione con contatto Cristiano. Catering/brand activation: pratica pronta per controllo commerciale; generazione economica del preventivo ancora da completare. Noleggio: bozza con nota tariffaria, non tariffa inventata.
- Coda revisioni consultabile e chiudibile con nota. Dopo il completamento manuale in Odoo, la chiusura riconcilia atomicamente anche il registro operazioni: riavvio e ricezione su altro canale non ripetono scritture. Testato anche il mancato salvataggio.
- Ruoli API distinti, test del rifiuto delle operazioni fuori ruolo, blocco scritture in READ_ONLY.
- Backup con controllo integrità e ripristino su nuovo file; test di checkpoint e registro operazioni preservati.

## Prerequisiti non completati

- Verificare su Odoo reale catalogo/varianti, tariffe, signed_on, scadenze e mappatura ordini confermati/opzioni. I dati dei preventivi letti sono riscontri parziali, non listini correnti.
- Eseguire il collaudo su database di prova dedicato, senza invii a clienti. Odoo reale non è stato usato per test di scrittura.
- Collaudare la riconciliazione su casi reali: completare manualmente le attività mancanti prima della chiusura. La ripresa automatica di singoli passaggi parziali non è implementata; non cancellare registri per forzare nuovi tentativi.
- Verificare rinnovo/revoca delle connessioni reali; configurare chiavi REVIEW_READ_TOKEN e REVIEW_WRITE_TOKEN distinte solo per gli utenti autorizzati. Non sono state create chiavi reali in questo ramo.
- Eseguire backup reale con servizio fermo, verificarne il ripristino e stabilire la riconciliazione delle operazioni successive al backup. Un backup locale di stato non sostituisce il backup Odoo.
- Verificare in browser l'interfaccia aggiornata: l'anteprima precedente può eseguire una versione meno recente.
- Il motore legacy workflow conserva uno schema diverso dall'ingresso email/Odoo: non esporlo come equivalente ai quattro percorsi senza allineamento.

## Procedura di rilascio

1. Revisionare l'intero diff: include modifiche locali preparate in precedenti fasi e raccolte in questo ramo.
2. Completare i prerequisiti sopra. Verificare configurazione effettiva su Render e funzionamento delle connessioni.
3. Pubblicare prima con READ_ONLY=true e AUTOMATION_ENABLED=false; verificare health, autenticazione, sola lettura e UI. Questa modalità cambia il comportamento operativo del servizio e va coordinata.
4. Attivare solo dopo collaudo integrato e verifica delle approvazioni. Non cambiare le regole di invio durante il rilascio.
5. In caso di errore fermare le automazioni, conservare stato e registro attuali e ritornare al commit precedente. Non sostituire alla cieca lo stato con una copia più vecchia: potrebbe consentire invii o scritture duplicati.

Base verificata: 2ee18a36c6f8d2b17f8eeaa353c828deed151f0e (7 ottobre 2026).
