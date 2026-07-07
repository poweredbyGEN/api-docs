import fs from 'node:fs';

const source =
	process.env.WHITEPAPER_SOURCE ||
	'/root/mac/Downloads/people-that-live-forever-whitepaper_1.md';
const destination = 'src/content/docs/whitepaper.md';

const whitepaper = fs.readFileSync(source, 'utf8').trimEnd();
const frontmatter = `---
title: Beings That Live Forever
description: XEL whitepaper for sovereign, persistent digital beings anchored by autonomous NFTs.
---

`;

fs.writeFileSync(destination, `${frontmatter}${whitepaper}\n`);
console.log(`Updated ${destination} from ${source}`);
