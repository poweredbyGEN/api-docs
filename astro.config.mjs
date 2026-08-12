// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://api.gen.pro',
	redirects: {
		'/guides/claude-code/': '/guides/mcp/',
		'/guides/claude-code.md': '/guides/mcp.md',
	},
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
				{
					// Animated aurora background (4 drifting blobs) injected as the first
					// body child, behind all content — matches the gen.pro homepage.
					tag: 'script',
					content: `document.addEventListener('DOMContentLoaded',function(){if(document.querySelector('.gen-aurora'))return;var a=document.createElement('div');a.className='gen-aurora';a.setAttribute('aria-hidden','true');['b1','b2','b3','b4'].forEach(function(c){var s=document.createElement('span');s.className=c;a.appendChild(s);});document.body.insertBefore(a,document.body.firstChild);});`,
				},
				{
					tag: 'link',
					attrs: { rel: 'alternate', type: 'text/plain', href: '/llms.txt', title: 'LLM-readable API reference' },
				},
				{
					tag: 'link',
					attrs: { rel: 'alternate', type: 'text/plain', href: '/llms-full.txt', title: 'LLM-readable full API reference' },
				},
				{
					tag: 'meta',
					attrs: { name: 'ai-content-declaration', content: 'This site provides API documentation for AI agents. See /llms.txt for machine-readable reference.' },
				},
			],
			customCss: ['./src/styles/custom.css'],
			components: {
				// GEN homepage pill header (logo + Home/Managed/Pricing + Open app).
				Header: './src/components/Header.astro',
				// Left sidebar = Search pinned on top of the page tree.
				Sidebar: './src/components/Sidebar.astro',
				// Theme toggle + social icons live in the footer.
				Footer: './src/components/Footer.astro',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/poweredbyGEN' },
				{ icon: 'x.com', label: 'X', href: 'https://x.com/gendotpro' },
				{ icon: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/gendotpro' },
				{ icon: 'tiktok', label: 'TikTok', href: 'https://www.tiktok.com/@gendotpro' },
			],
			sidebar: [
				{
					label: 'Start Here',
					collapsed: false,
					items: [
						{ label: 'Introduction', slug: '' },
						{ label: 'The 5-Step Journey', slug: 'journey' },
						{ label: 'Quick Start', slug: 'guides/quickstart' },
						{ label: 'Authentication', slug: 'guides/authentication' },
						{ label: 'Install the MCP Server', slug: 'guides/mcp' },
						{ label: 'TypeScript SDK', slug: 'guides/typescript-sdk' },
						{ label: 'Using with n8n', slug: 'guides/n8n' },
					],
				},
				{
					label: 'Step 1 — Set Up Your Agent',
					collapsed: false,
					items: [
						{ label: 'Overview', slug: 'step-1-setup/overview' },
						{ label: 'Agent Core (one PATCH)', slug: 'reference/agent-core' },
						{ label: 'Voice Design', slug: 'reference/agent-voice' },
						{ label: 'Agents', slug: 'reference/agents' },
						{ label: 'Organizations & Workspaces', slug: 'reference/organizations' },
						{ label: 'API Keys', slug: 'reference/api-keys' },
					],
				},
				{
					label: 'Step 2 — Generate Content Ideas',
					collapsed: false,
					items: [
						{ label: 'Overview', slug: 'step-2-ideas/overview' },
						{ label: 'Ideas Engine', slug: 'guides/content-ideas' },
						{ label: 'Refine Ideas', slug: 'step-2-ideas/refine' },
						{ label: 'Trending Data', slug: 'reference/content-monitoring' },
						{ label: 'Research', slug: 'step-2-ideas/research' },
						{ label: 'Preferences', slug: 'step-2-ideas/preferences' },
						{ label: 'Conversations', slug: 'step-2-ideas/conversations' },
					],
				},
				{
					label: 'Step 3 — Convert Idea to Vidsheet',
					collapsed: false,
					items: [
						{ label: 'Overview', slug: 'step-3-convert/overview' },
						{ label: 'Start from a Template (recommended)', slug: 'step-3-convert/start-from-template' },
						{ label: 'Browse Templates', slug: 'reference/templates' },
						{ label: 'Clone a Template', slug: 'step-3-convert/clone-template' },
						{ label: 'Build a Custom Engine', slug: 'reference/sheets' },
					],
				},
				{
					label: 'Step 4 — Edit & Generate',
					collapsed: false,
					items: [
						{ label: 'Overview', slug: 'step-4-edit/overview' },
						{ label: 'Vidsheet Anatomy', slug: 'step-4-edit/anatomy' },
						{
							label: 'Creation Cards (10 types)',
							collapsed: false,
							items: [
								{ label: 'Creation Cards Overview', slug: 'reference/creation-cards' },
								{ label: 'Text', slug: 'reference/cards/text' },
								{ label: 'Image from Text', slug: 'reference/cards/image-from-text' },
								{ label: 'Video from Text', slug: 'reference/cards/video-from-text' },
								{ label: 'Video from Image', slug: 'reference/cards/video-from-image' },
								{ label: 'Video from Ingredients', slug: 'reference/cards/video-from-ingredients' },
								{ label: 'Speech from Text', slug: 'reference/cards/speech-from-text' },
								{ label: 'Lipsync', slug: 'reference/cards/lipsync' },
								{ label: 'Captions', slug: 'reference/cards/captions' },
								{ label: 'Transcription', slug: 'reference/cards/transcription' },
								{ label: 'Media (Upload)', slug: 'reference/cards/media' },
							],
						},
						{ label: 'Rows', slug: 'reference/rows' },
						{ label: 'Columns', slug: 'reference/columns' },
						{ label: 'Cells', slug: 'reference/cells' },
						{ label: 'Layers', slug: 'reference/layers' },
						{ label: 'Variables', slug: 'reference/variables' },
						{ label: 'Assets & Content Resources', slug: 'reference/content-resources' },
						{ label: 'Proof of Genesis Backups', slug: 'reference/proof-of-genesis' },
						{ label: 'Trigger + Poll a Generation', slug: 'reference/generations' },
						{ label: 'Regenerate Workflow', slug: 'step-4-edit/regenerate' },
					],
				},
				{
					label: 'Step 5 — Export & Publish',
					collapsed: false,
					items: [
						{ label: 'Overview', slug: 'step-5-export/overview' },
						{ label: 'Render the Final Video', slug: 'reference/rendering' },
						{ label: 'Download the Video', slug: 'step-5-export/download' },
						{ label: 'Publish to Social', slug: 'reference/publishing' },
						{ label: 'Credits & Billing', slug: 'step-5-export/credits' },
					],
				},
				{
					label: 'Monitoring & Automation',
					collapsed: false,
					items: [
						{ label: 'Monitoring Quickstart', slug: 'guides/monitoring-quickstart' },
						{ label: 'Watchlists', slug: 'reference/watchlists' },
						{ label: 'Recurring Jobs (Daily Tasks)', slug: 'reference/recurring-jobs' },
						{ label: 'Song Mixes', slug: 'reference/song-mixes' },
					],
				},
				{
					label: 'Reference',
					collapsed: false,
					items: [
						{ label: 'API Overview', slug: 'reference/overview' },
						{ label: 'All Endpoints A–Z', slug: 'reference/endpoints-index' },
						{ label: 'All Generation Types', slug: 'reference/generation-types' },
						{ label: 'Error Codes', slug: 'guides/errors' },
						{ label: 'Discovery', slug: 'reference/discovery' },
						{ label: 'Agent Chat', slug: 'reference/agent-chat' },
						{ label: 'Automation', slug: 'reference/automation' },
						{ label: 'Pipelines', slug: 'reference/pipelines' },
					],
				},
			],
		}),
	],
});
