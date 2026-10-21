import test from 'node:test';
import assert from 'node:assert/strict';
import {depositAmount,rentalTerms,isDepositProduct} from '../src/commercialTerms.js';
test('deposit is taken from explicit vehicle description, not guessed',()=>{
 for(const text of ['Cauzione €3000,00','Cauzione €3.000,00','Cauzione €3000']) assert.equal(depositAmount(text),3000);
 assert.equal(depositAmount('Prezzo €3000'),null);
 assert.equal(depositAmount('Cauzione €3000; cauzione €2500'),null);
});
test('legacy payment placeholders removed without removing contract preamble',()=>{
 const note=rentalTerms('<div>Condizioni generali: contratto allegato</div><div>Termini di pagamento:</div><p>acconto 50%; saldo ...... cauzione € .....</p>',3000);
 assert.match(note,/contratto allegato/);assert.match(note,/saldo alla conferma/);assert.match(note,/30 giorni/);assert.match(note,/3.000,00/);assert.doesNotMatch(note,/acconto|\.\.\./);
 assert.throws(()=>rentalTerms('Acconto 50% e saldo da concordare',3000));
});
test('deposits are distinct from advance payments and ordinary products mentioning a deposit in description',()=>{
 assert(isDepositProduct('Cauzione foodtruck'));assert(!isDepositProduct('Acconto'));
 assert(!isDepositProduct('Airstream Replica 4m'));
 assert.match(rentalTerms('',null),/da verificare prima/);
});

test('template conditions are replaced once when a vehicle deposit becomes known',()=>{const result=rentalTerms(rentalTerms('Contratto',null),3000);assert.equal((result.match(/Pagamento:/g)||[]).length,1);assert.doesNotMatch(result,/Importo specifico/);assert.match(result,/3.000,00/);});
