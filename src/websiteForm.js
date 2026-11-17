// Only the site's exact notification format supplies a customer address.
// Ordinary internal mail, forwards and quoted forms retain their real sender.
export function websiteFormMessage(parsed) {
  if (String(parsed.subject||'').trim()!=='Nuovo dato inserito: Form contatti'
      || parsed.from?.value?.length!==1
      || parsed.from.value[0].address?.toLowerCase()!=='hello@fancytruck.it'
      || !/@www\.fancytruck\.it>$/.test(parsed.messageId||'')) return parsed;
  const text=String(parsed.text||'').replace(/\r/g,'');
  const match=/^\s*Nome e Cognome\s+(.{1,200}?)\s+Email\s+([^\s<>\[\],;@]+@[^\s<>\[\],;@]+\.[^\s<>\[\],;@]+)(?:\s+\[\2\])?\s+Messaggio\s+([\s\S]+?)\s+Inviato da Fancy Truck\s+\[https:\/\/www\.fancytruck\.it\]\s*$/.exec(text);
  if(!match||/@fancytruck\.it$/i.test(match[2]))return parsed;
  return {...parsed,websiteForm:true,originalFrom:parsed.from,
    from:{value:[{name:match[1].trim(),address:match[2].toLowerCase()}]},text:match[3].trim()};
}
