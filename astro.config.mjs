// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const SITE_URL = process.env.SITE_URL || 'https://docs.xel.xyz';

export default defineConfig({
	site: SITE_URL,
	integrations: [
		starlight({
			title: 'XEL Docs',
			favicon: '/favicon.svg',
			logo: {
				src: './src/assets/xel-logo.svg',
				replacesTitle: true,
			},
			head: [
				{
					tag: 'script',
					content: `if (!localStorage.getItem('starlight-theme')) { localStorage.setItem('starlight-theme', 'dark'); }`,
				},
				{
					tag: 'meta',
					attrs: {
						name: 'description',
						content:
							'Protocol documentation for XEL Living Characters, sovereign onchain identities with funding, memory, runtime, and provenance.',
					},
				},
				{
					tag: 'meta',
					attrs: { property: 'og:site_name', content: 'XEL Docs' },
				},
				{
					tag: 'meta',
					attrs: { property: 'og:title', content: 'XEL Docs' },
				},
				{
					tag: 'meta',
					attrs: {
						property: 'og:description',
						content: 'Build, mint, fund, and run Living Characters with XEL.',
					},
				},
			],
			customCss: ['./src/styles/custom.css'],
			components: {
				Header: './src/components/Header.astro',
				Sidebar: './src/components/Sidebar.astro',
				Footer: './src/components/Footer.astro',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/poweredbyGEN/xel' },
				{ icon: 'x.com', label: 'XEL', href: 'https://xel.xyz' },
			],
			sidebar: [
				{
					label: 'Start Here',
					collapsed: false,
					items: [
						{ label: 'Overview', slug: '' },
						{ label: 'Whitepaper', slug: 'whitepaper' },
						{ label: 'Workstreams', slug: 'workstreams' },
						{ label: 'Architecture Boundaries', slug: 'architecture-boundaries' },
						{ label: 'Open Source Scope', slug: 'open-source-scope' },
					],
				},
				{
					label: 'Protocol',
					collapsed: false,
					items: [
						{ label: 'Minting and Runtime Inputs', slug: 'minting-and-runtime-inputs' },
						{ label: 'Smart Contracts', slug: 'smart-contracts' },
						{ label: 'Wallet Auth and Product Shell', slug: 'wallet-auth-and-xel-product' },
						{ label: 'Security and Acceptance Gates', slug: 'security-and-acceptance' },
						{ label: 'Sui Testnet Deployment', slug: 'sui-devnet-deployment' },
					],
				},
				{
					label: 'Runtime',
					collapsed: false,
					items: [
						{ label: 'Memory, Inference, and Storage', slug: 'memory-inference-storage' },
						{ label: 'Payments, Treasury, Provider Discovery', slug: 'payments-treasury-provider-discovery' },
						{ label: 'Cost Model and Funding', slug: 'cost-model-and-funding' },
						{ label: 'GEN Publish to XEL', slug: 'gen-publish-to-xel' },
					],
				},
				{
					label: 'Providers',
					collapsed: false,
					items: [
						{ label: 'Inference Provider Strategy', slug: 'inference-provider-strategy' },
						{ label: 'Chutes Integration', slug: 'chutes-integration' },
						{ label: 'Verathos Integration', slug: 'verathos-integration' },
						{ label: 'Talus Nexus Orchestration', slug: 'talus-nexus-orchestration' },
					],
				},
			],
		}),
	],
});
