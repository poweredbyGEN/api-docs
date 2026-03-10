// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://dev.gen.pro',
	integrations: [
		starlight({
			title: 'GEN API',
			favicon: '/favicon.png',
			logo: {
				src: './src/assets/logo.svg',
				replacesTitle: true,
			},
			head: [
				{
					tag: 'script',
					content: `if (!localStorage.getItem('starlight-theme')) { localStorage.setItem('starlight-theme', 'dark'); }`,
				},
			],
			customCss: ['./src/styles/custom.css'],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/poweredbyGEN' },
				{ icon: 'x.com', label: 'X', href: 'https://x.com/gendotpro' },
				{ icon: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/gendotpro' },
				{ icon: 'tiktok', label: 'TikTok', href: 'https://www.tiktok.com/@gendotpro' },
			],
			sidebar: [
				{
					label: 'Getting Started',
					collapsed: false,
					items: [
						{ label: 'Introduction', slug: 'guides/introduction' },
						{ label: 'Using with Claude Code', slug: 'guides/claude-code' },
						{ label: 'Authentication', slug: 'guides/authentication' },
						{ label: 'Quick Start', slug: 'guides/quickstart' },
					],
				},
				{
					label: 'API Reference',
					collapsed: false,
					items: [
						{ label: 'Overview', slug: 'reference/overview' },
						{ label: 'Discovery', slug: 'reference/discovery' },
						{ label: 'API Keys', slug: 'reference/api-keys' },
						{ label: 'Auto Content Engine', slug: 'reference/sheets' },
						{ label: 'Rows', slug: 'reference/rows' },
						{ label: 'Columns', slug: 'reference/columns' },
						{ label: 'Cells', slug: 'reference/cells' },
						{ label: 'Layers', slug: 'reference/layers' },
						{ label: 'Generations', slug: 'reference/generations' },
						{
							label: 'Creation Cards',
							collapsed: false,
							items: [
								{ label: 'Overview', slug: 'reference/creation-cards' },
								{ label: 'Text', slug: 'reference/cards/text' },
								{ label: 'Image from Text', slug: 'reference/cards/image-from-text' },
								{ label: 'Video from Text', slug: 'reference/cards/video-from-text' },
								{ label: 'Video from Image', slug: 'reference/cards/video-from-image' },
								{ label: 'Video from Ingredients', slug: 'reference/cards/video-from-ingredients' },
								{ label: 'Speech from Text', slug: 'reference/cards/speech-from-text' },
								{ label: 'Lipsync', slug: 'reference/cards/lipsync' },
								{ label: 'Captions', slug: 'reference/cards/captions' },
								{ label: 'Media', slug: 'reference/cards/media' },
							],
						},
						{ label: 'Variables', slug: 'reference/variables' },
						{ label: 'Automation', slug: 'reference/automation' },
						{ label: 'Pipelines', slug: 'reference/pipelines' },
						{ label: 'Agents', slug: 'reference/agents' },
						{ label: 'Organizations', slug: 'reference/organizations' },
						{ label: 'Content Resources', slug: 'reference/content-resources' },
					],
				},
				{
					label: 'Guides',
					collapsed: false,
					items: [
						{ label: 'Using with n8n', slug: 'guides/n8n' },
						{ label: 'Error Handling', slug: 'guides/errors' },
					],
				},
			],
		}),
	],
});
