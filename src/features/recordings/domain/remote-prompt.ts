export function buildRemotePrompt(fictionalExample: string): string {
  const example = fictionalExample.replaceAll('*', '').replaceAll(/\s+/g, ' ').trim();
  if (!example) throw new Error('Enter a fictional example before sharing.');
  return [
    'Iyi njo exemple ya kuji-référer ako. Usiisome mot à mot; sema vile utaweza kuisema réellement.',
    `*${example}*`,
  ].join('\n\n');
}
