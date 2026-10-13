import { buildStylePrompt, loadStyleSource } from '../../extensions/pohuy/style-source.ts';

const source = await loadStyleSource();
const prompt = buildStylePrompt({ tier: 'full' }, source);
console.log(['<!-- pohuy:start -->', '# Pohuy', prompt, '<!-- pohuy:end -->'].join('\n\n'));
