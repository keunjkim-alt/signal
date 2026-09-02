import { cp, mkdir, rm } from 'node:fs/promises';
import { validateColorPalette } from './validate-color-palette.mjs';

await validateColorPalette();
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'connections.css', 'product-images.css', 'insights.css', 'daily-trends.css', 'sales-views.css', 'phase-one.css', 'phase-two.css', 'customer-data.css', 'review-voc.css', 'customer-insights-v2.css', 'phase-three.css', 'workflow-updates.css', 'workflow-actions.css', 'semantic-charts.css', 'ax-command.css', 'ax-panel.css', 'auth.css', 'data-runtime.css', 'todays-action.css', 'discount-optimizer.css', 'china-tone.css', 'brand-refresh.css', 'operational-data.css', 'closed-beta.css', 'workspaces.css', 'data-governance.css', 'blue-theme.css', 'color-palette.css', 'app.js', 'vercel.json']) await cp(file, `dist/${file}`);
await mkdir('dist/assets', { recursive: true });
await cp('assets', 'dist/assets', { recursive: true });
console.log('Built static app → dist/');
