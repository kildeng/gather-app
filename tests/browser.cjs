// Run against the local Netlify server. Preview is injected only into this test page.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/index.html', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('const DEMO = firebaseConfig.apiKey === "YOUR_API_KEY";', 'const DEMO = true;');
      await route.fulfill({ response, body });
    });
    await page.goto('http://127.0.0.1:8888/index.html');
    await page.getByRole('button', { name: 'Small Groups', exact: true }).click();
    await page.getByRole('heading', { name: 'Faith Group', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Members', exact: true }).click();
    assert.equal(await page.locator('.sg-member').count(), 5);
    assert.equal(await page.locator('#vGroups').innerText().then(t => t.includes('@example.com')), false);
    await page.getByRole('button', { name: 'Small Groups Admin', exact: true }).click();
    await page.getByRole('button', { name: '＋ Create Group', exact: true }).click();
    await page.getByLabel('Group Name', { exact: true }).fill('Grace Group');
    await page.getByLabel('Description', { exact: true }).fill('A place to grow together.');
    await page.locator('[name="leaderId"]').selectOption('me');
    await page.getByLabel('Daniel', { exact: true }).check();
    await page.locator('[name="meetingDay"]').selectOption('Sunday');
    await page.getByLabel('Meeting Time', { exact: true }).fill('18:00');
    await page.getByLabel('Meeting Location', { exact: true }).fill('Fellowship Hall');
    await page.getByRole('button', { name: 'Save Group', exact: true }).click();
    await page.getByRole('heading', { name: 'Grace Group', exact: true }).waitFor();
    assert.match(await page.locator('#vGroups').innerText(), /Fellowship Hall/);
    await page.getByRole('button', { name: 'Members', exact: true }).click();
    assert.equal(await page.locator('.sg-member').count(), 2);
    await page.getByRole('button', { name: 'My Group', exact: true }).click();
    await page.getByRole('button', { name: 'Edit group details', exact: true }).click();
    await page.getByLabel('Group Name', { exact: true }).fill('Grace & Hope');
    await page.locator('[name="status"]').selectOption('archived');
    await page.getByRole('button', { name: 'Save Group', exact: true }).click();
    await page.getByRole('heading', { name: 'Grace & Hope', exact: true }).waitFor();
    assert.match(await page.locator('#vGroups').innerText(), /ARCHIVED GROUP/);
    await page.getByRole('button', { name: 'News', exact: true }).click();
    await page.getByRole('heading', { name: /Fall Outing/ }).waitFor();
    await page.locator('[data-tab="chats"]').click();
    assert.match(await page.locator('#vChats').innerText(), /Worship Team/);
    await page.locator('#demoRole').selectOption('member');
    await page.getByRole('button', { name: 'Small Groups', exact: true }).click();
    await page.getByRole('heading', { name: 'Faith Group', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Small Groups Admin', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Edit group details', exact: true }).count(), 0);
    assert.equal(await page.locator('#sgSelect option').count(), 1);
    await page.locator('#demoRole').selectOption('out');
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).waitFor();
    assert.equal(await page.locator('#vGroups').innerText(), '');
    assert.deepEqual(errors, []);
    console.log('PASS: mobile group home/directory, admin create/edit, member permissions, group isolation, sign-out cleanup, existing news/chats.');

    // Existing church leader is a small-group leader, not automatically an admin.
    const leaderPage = await browser.newPage({ viewport: { width: 320, height: 740 }, serviceWorkers: 'block' });
    await leaderPage.route('**/index.html', async route => {
      const response = await route.fetch();
      const body = (await response.text())
        .replace('const DEMO = firebaseConfig.apiKey === "YOUR_API_KEY";', 'const DEMO = true;')
        .replace('[FG]: { id: FG, name:"FGYG", createdBy:"me"', '[FG]: { id: FG, name:"FGYG", createdBy:"owner"');
      await route.fulfill({ response, body });
    });
    await leaderPage.goto('http://127.0.0.1:8888/index.html');
    await leaderPage.getByRole('button', { name: 'Small Groups', exact: true }).click();
    await leaderPage.getByRole('button', { name: 'Edit group details', exact: true }).click();
    assert.equal(await leaderPage.locator('[name="leaderId"]').count(), 0);
    assert.equal(await leaderPage.locator('[name="memberIds"]').count(), 0);
    await leaderPage.getByLabel('Meeting Location', { exact: true }).fill('Room 4');
    await leaderPage.getByRole('button', { name: 'Save Group', exact: true }).click();
    assert.match(await leaderPage.locator('#vGroups').innerText(), /Room 4/);
    assert.equal(await leaderPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await leaderPage.getByRole('button', { name: 'Small Groups Admin', exact: true }).count(), 0);
    await leaderPage.setViewportSize({ width: 1280, height: 900 });
    await leaderPage.getByRole('button', { name: 'Members', exact: true }).click();
    assert.equal(await leaderPage.locator('.sg-member').count(), 5);
    assert.equal(await leaderPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log('PASS: leader edits only group details; 320px mobile and desktop directory layout.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
