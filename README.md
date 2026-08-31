# Fancy Truck automation backend

Motore cloud per il processo commerciale e operativo Fancy Truck. Il servizio è progettato per restare attivo senza una chat aperta e usa Odoo e le integrazioni esterne come sistemi operativi.

## Regole di sicurezza

- Letture, verifiche, classificazioni, aggiornamenti certi, lead, anagrafiche, bozze e progetti possono essere automatici.
- Qualsiasi comunicazione o azione esterna viene salvata come `PENDING_APPROVAL`.
- L'esecuzione richiede due passaggi distinti di Pietro: comando specifico `APPROVA <action-id>` e token di conferma finale.
- Pagamenti, rimborsi, cauzioni e abbinamenti incerti non vengono mai eseguiti automaticamente.
- Ogni operazione usa una chiave idempotente e produce un evento di audit.

## Pianificazione

Il ciclo ordinario gira una volta all'ora esclusivamente tra le 08:00 e le 19:59 `Europe/Rome`. Webhook e scadenze possono avviare controlli immediati. `/health` diventa non sano se, durante la fascia operativa, non viene completato un ciclo per oltre due ore.

## Persistenza

Impostare `STATE_FILE=/var/data/fancy-truck-state.json` e montare un disco persistente Render su `/var/data`. Il file viene scritto atomicamente con permessi `0600`. Su un'istanza senza disco il filesystem è effimero e non è adatto alla produzione.

## Integrazioni

Già previste: Aruba IMAP/SMTP, Odoo CRM/Vendite/Noleggi/Progetti e API protetta. La health espone soltanto lo stato di configurazione, mai i segreti.

Da configurare con credenziali ufficiali per completare l'esecuzione reale: doppio riscontro Gmail, Odoo Firma, Sistemi.cloud/Sportello.cloud, Quadra/banca e notifiche mobili. Se una fonte non è configurata o interrogabile, il ciclo registra `CONTROLLO NON COMPLETATO`.

## Comandi

```bash
npm install
npm run check
npm test
npm start
```
