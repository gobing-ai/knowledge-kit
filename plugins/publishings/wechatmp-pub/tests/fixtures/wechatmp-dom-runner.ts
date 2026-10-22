/**
 * Real-Chromium fixture runner (task 0260 plan step 2): executes the PRODUCTION enrichment rail and
 * audio picker (`wrapPlaywrightPage` adapters, live `evaluate` expressions, real actionability)
 * against synthetic editor DOM built from the 0272-measured shapes. bun:test spawns one process per
 * scenario; the observed facts print as the LAST stdout line (JSON) and every assertion lives in
 * `tests/wechatmp-dom.test.ts`. Missing Chromium surfaces as a runner error with stderr — an
 * actionable environment failure, never a silent skip.
 *
 * Usage: bun tests/fixtures/wechatmp-dom-runner.ts <scenario>
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { enrichArticle } from '../../src/enrich';
import { insertAudioMaterial } from '../../src/flow';
import { wrapPlaywrightPage } from '../../src/page';

/** What a scenario wires and what the runner reports. Assertions stay in bun:test. */
interface ScenarioConfig {
    original?: { committed?: boolean; confirmApplies?: boolean; closable?: boolean; agreementChecked?: boolean };
    reward?: { committed?: boolean; account?: string };
    claim?: { committed?: boolean; text?: string; confirmApplies?: boolean; unavailable?: boolean };
    url?: { committed?: string; confirmApplies?: boolean; missingField?: boolean; delayCommitMs?: number };
    audio?: {
        rows?: Array<{ title: string; mediaId: string }>;
        uploadForm?: boolean;
        /** 插入 clicked but the body node is silently dropped — VERIFY must fail. */
        silentDrop?: boolean;
        /** Row appears only after the upload 保存 (delayed commit). */
        delayRowMs?: number;
    };
    run: 'enrich' | 'audio';
    meta?: Record<string, unknown>;
    title?: string;
}

interface Facts {
    scenario: string;
    warnings?: string[];
    error?: string;
    ops?: {
        clicks: Record<string, number>;
        uploads: string[];
        audioResult?: string;
        committed?: Record<string, unknown>;
        accountValue?: string | null;
        insertedMediaId?: string | null;
        tickedRows?: string[];
        dialogsOpen?: string[];
        insertClicked?: boolean;
    };
}

const SETTINGS_HTML = `
<div class="settings-panel">
  <h3>原创声明</h3>
  <div class="setting-group">
    <div id="js_original">
      <div data-original-empty>
      <div class="setting-group__content-info" data-op="original" style="width:100px;height:20px">原创</div>
      <!-- 2026-10-21 measured: the committed probe reads the row-scoped switch input; the old bare
           id-scoped union also matched the open dialog's template, so a fresh page read as uncommitted. -->
      <div class="setting-group__switch"><input type="checkbox" class="weui-desktop-switch__input" data-op="original-switch" hidden></div>
      </div>
      <div id="js_original_open" style="display:none"><div class="setting-group__switch"><input type="checkbox" class="weui-desktop-switch__input" hidden checked></div></div>
    </div>
  </div>
  <div class="setting-group">
    <div class="setting-group__switch js_reward_open" data-op="reward" style="width:80px;height:20px">赞赏</div>
    <span id="js_reward_setting_area"><input type="checkbox" class="js_reward_setting_checkbox"></span>
  </div>
  <div id="js_claim_source_area">
    <div class="frm_checkbox_label" style="width:180px;height:20px">创作来源<span class="allow_click_opr" data-op="claim">未选择</span><span class="js_claim_source_selected"></span><input type="checkbox" class="js_claim_source"></div>
  </div>
  <div id="js_article_url_area"><label class="frm_checkbox_label"><input type="checkbox" class="js_url_checkbox"><span>原文链接</span><div class="allow_click_opr js_article_url_allow_click">未添加<span class="article_url_setting"></span></div></label></div>
</div>
<div class="popover_inner" id="url-popover" style="display:none"><div class="popover-article-setting__content"><input class="js_url" name="source_url" placeholder="输入或粘贴原文链接"></div><div class="popover_bar"><a class="jsPopoverBt btn_primary">确定</a><a class="jsPopoverBt btn_default">取消</a></div></div>
<div id="audio_music_plugin_btn" style="width:40px;height:20px">音频</div>
<ul><li class="js_insertaudio" style="display:none;width:40px;height:20px">音频</li></ul>
<div class="ProseMirror" contenteditable="true"><p><br></p></div>
<div class="weui-desktop-dialog__wrp" id="dlg-wrp" style="display:none"><div class="weui-desktop-dialog" id="dlg"></div></div>
<div class="weui-desktop-dialog__wrp" id="dlg2-wrp" style="display:none"><div class="weui-desktop-dialog" id="dlg2"></div></div>
<div class="weui-desktop-dialog__wrp" id="audio-wrp" style="display:none"><div class="weui-desktop-dialog audio_dialog" id="audio-dlg"></div></div>
<div class="weui-desktop-dialog__wrp" id="unrelated-wrp" style="display:none"><div class="weui-desktop-dialog" id="unrelated-dlg"><input type="file" accept="audio/mpeg" data-name="unrelated-audio"></div></div>
<style>.weui-desktop-dialog__wrp{position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.3)}</style>`;

/** Dialog/row wiring shared by every scenario; runs inside the page. */
const WIRE = `
(cfg) => {
  window.__ops = { clicks: {}, uploads: [], insertClicked: false };
  window.__op = (k) => { window.__ops.clicks[k] = (window.__ops.clicks[k] ?? 0) + 1; };
  const dialog = (wrpId, cfg2, onConfirm) => {
    const wrp = document.getElementById(wrpId);
    const dlg = wrp.querySelector('.weui-desktop-dialog');
    const close = () => { wrp.style.display = 'none'; };
    const closable = cfg2.closable !== false;
    dlg.innerHTML = (closable ? '<button class="weui-desktop-dialog__close-btn">×</button>' : '') + (cfg2.body ?? '') +
      '<div>' + (closable ? '<button class="weui-cancel">取消</button>' : '') +
      '<button class="weui-confirm weui-desktop-btn_primary">' + (cfg2.confirm ?? '确定') + '</button></div>';
    wrp.style.display = 'block';
    if (closable) dlg.querySelector('.weui-cancel, .weui-desktop-dialog__close-btn').addEventListener('click', close);
    dlg.querySelector('.weui-confirm').addEventListener('click', () => {
      if (!onConfirm || onConfirm(dlg)) close();
    });
    return close;
  };
  const claimText = () => document.querySelector('.js_claim_source_selected').textContent;
  if (cfg.url) {
    const popover = document.getElementById('url-popover');
    if (cfg.url.missingField) popover.querySelector('input').remove();
    if (cfg.url.committed) {
      document.querySelector('#js_article_url_area input').checked = true;
      document.querySelector('.article_url_setting').textContent = cfg.url.committed;
    }
    document.querySelector('.js_article_url_allow_click').addEventListener('click', (e) => {
      e.preventDefault();
      window.__op('url');
      popover.style.display = 'block';
    });
    popover.querySelector('.btn_primary').addEventListener('click', () => {
      if (cfg.url.confirmApplies === false) return;
      const commit = () => {
        document.querySelector('.article_url_setting').textContent = popover.querySelector('input').value;
        document.querySelector('#js_article_url_area input').checked = true;
        popover.style.display = 'none';
      };
      if (cfg.url.delayCommitMs) setTimeout(commit, cfg.url.delayCommitMs); else commit();
    });
    popover.querySelector('.btn_default').addEventListener('click', () => { popover.style.display = 'none'; });
  }
  if (cfg.original) {
    document.querySelector('#js_original .setting-group__content-info').addEventListener('click', () => {
      window.__op('original');
      dialog('dlg-wrp', { closable: cfg.original.closable, body:
        '<label style="width:90px;height:20px"><input type="radio" class="js_original_type_radio" name="ori" checked>文字原创</label>' +
        '<label class="original_agreement"><input type="checkbox" hidden ' + (cfg.original.agreementChecked ? 'checked' : '') + '>我已阅读并同意《微信公众平台原创声明及相关功能使用协议》</label>' },
      (dlg) => {
        if (!dlg.querySelector('.original_agreement input').checked || !dlg.querySelector('.js_original_type_radio').checked) return false;
        if (cfg.original.confirmApplies !== false) {
                document.querySelector('[data-original-empty]').style.display = 'none';
                document.querySelector('#js_original_open').style.display = 'block';
            }
        return cfg.original.confirmApplies !== false;
      });
    });
  }
  if (cfg.reward) {
    document.querySelector('.js_reward_open').addEventListener('click', () => {
      window.__op('reward');
      dialog('dlg-wrp', { body: '<input class="frm_input" placeholder="赞赏账户" style="width:160px;height:20px">' },
      () => {
        document.querySelector('.js_reward_setting_checkbox').checked = true;
        return true;
      });
    });
  }
  if (cfg.claim) {
    document.querySelector('[data-op="claim"]').addEventListener('click', () => {
      window.__op('claim');
      dialog('dlg2-wrp', { confirm: '确认', body: cfg.claim.unavailable ? '<label>无需声明</label>' : '<label class="claim-option" style="width:150px;height:20px"><input type="radio" name="claim"><span>个人观点，仅供参考</span></label>' },
      (dlg) => {
        if (!dlg.querySelector('input[name=claim]:checked')) return false;
        if (cfg.claim.confirmApplies !== false) {
          document.querySelector('.js_claim_source_selected').textContent = '个人观点，仅供参考';
          document.querySelector('.js_claim_source').checked = true;
        }
        return cfg.claim.confirmApplies !== false;
      });
    });
  }
  if (cfg.audio) {
    const addRow = (row) => {
      const li = document.createElement('li');
      li.className = 'audio_item_wrp';
      li.setAttribute('data-mediaid', row.mediaId);
      li.innerHTML = '<label class="frm_checkbox_label audio_item" style="width:160px;height:20px">' +
        '<span class="audio_title">' + row.title + '</span><input type="checkbox"></label>' +
        '<div class="audio_item_thumb" style="background-image:url(&quot;https://mmbiz.example/' + row.mediaId + '.png&quot;)"></div>';
      document.getElementById('audio-dlg').querySelector('.audio-list').appendChild(li);
    };
    const dlg = document.getElementById('audio-dlg');
    dlg.innerHTML = '<button class="weui-desktop-dialog__close-btn">×</button><div class="audio-list"></div>' +
      (cfg.audio.uploadForm
        ? '<div class="upload-form"><button class="js-open-upload">上传音频</button>' +
          '<div class="form-body" style="display:none"><button class="js-cover-btn">上传封面</button>' +
          '<input type="file" accept="audio/mpeg" data-name="audio-input"><input type="file" accept="image/png" data-name="cover-input">' +
          '<input class="frm_input" placeholder="标题"><label><input type="checkbox" class="agree-box"><span>我已阅读并同意《服务规则》</span></label>' +
          '<button class="js-save-btn">保存</button></div></div>'
        : '') +
      '<div><button class="weui-cancel">取消</button><button class="js-insert-btn">插入</button></div>';
    document.getElementById('audio_music_plugin_btn').addEventListener('click', () => {
      document.querySelector('.js_insertaudio').style.display = 'block';
      document.querySelector('.js_insertaudio').addEventListener('click', () => {
        document.getElementById('audio-wrp').style.display = 'block';
        (cfg.audio.rows ?? []).forEach(addRow);
      }, { once: true });
    });
    dlg.querySelector('.weui-cancel, .weui-desktop-dialog__close-btn').addEventListener('click', () => {
      document.getElementById('audio-wrp').style.display = 'none';
    });
    dlg.querySelector('.js-insert-btn').addEventListener('click', () => {
      window.__ops.insertClicked = true;
      const ticked = dlg.querySelector('.audio_item input:checked');
      if (cfg.audio.silentDrop !== true && ticked) {
        const mediaId = ticked.closest('li').getAttribute('data-mediaid');
        const pm = document.querySelector('.ProseMirror');
        const node = document.createElement('mpvoice');
        node.setAttribute('data-mediaid', mediaId);
        pm.insertBefore(node, pm.firstChild);
      }
      document.getElementById('audio-wrp').style.display = 'none';
    });
    if (cfg.audio.uploadForm) {
      dlg.querySelector('.js-open-upload').addEventListener('click', () => {
        dlg.querySelector('.upload-form').style.display = 'block';
        dlg.querySelector('.form-body').style.display = 'block';
      });
      dlg.querySelector('.js-cover-btn').addEventListener('click', () => {});
      dlg.querySelector('.js-save-btn').addEventListener('click', () => {
        const appear = () => addRow({ title: ' 上传的新音频 ', mediaId: 'media-7' });
        if (cfg.audio.delayRowMs) setTimeout(appear, cfg.audio.delayRowMs); else appear();
      });
    }
  }
  document.querySelectorAll('input[type=file]').forEach((input) =>
    input.addEventListener('change', () => {
      window.__ops.uploads.push(input.dataset.name ?? 'unnamed');
    }),
  );
}`;

const COLLECT = `
(() => {
  const state = (sel) => { const el = document.querySelector(sel); return el ? el.checked === true : null; };
  return {
    clicks: window.__ops.clicks,
    uploads: window.__ops.uploads,
    insertClicked: window.__ops.insertClicked,
    committed: {
      original: [...document.querySelectorAll('#js_original .weui-desktop-switch__input')].find(el => el.parentElement.getClientRects().length)?.checked ?? null,
      reward: state('.js_reward_setting_checkbox'),
      claim: state('.js_claim_source'),
    },
    claimText: document.querySelector('.js_claim_source_selected').textContent,
    accountValue: document.querySelector('#dlg input.frm_input')?.value ?? null,
    urlValue: document.querySelector('.article_url_setting')?.textContent ?? null,
    urlPopoverOpen: document.getElementById('url-popover').style.display !== 'none',
    insertedMediaId: document.querySelector('.ProseMirror mpvoice, .ProseMirror [data-mediaid]')?.getAttribute('data-mediaid') ?? null,
    tickedRows: [...document.querySelectorAll('.audio_item input:checked')].map((el) => el.closest('li').getAttribute('data-mediaid')),
    dialogsOpen: [...document.querySelectorAll('.weui-desktop-dialog__wrp')]
      .filter((w) => w.style.display !== 'none')
      .map((w) => w.id),
  };
})()`;

async function runScenario(scenario: string): Promise<Facts> {
    const configs: Record<string, ScenarioConfig> = {
        '0318-url-commit': {
            run: 'enrich',
            url: { delayCommitMs: 350 },
            meta: { originalUrl: 'https://example.com/0318' },
        },
        '0318-url-skip': {
            run: 'enrich',
            url: { committed: 'https://example.com/0318' },
            meta: { originalUrl: 'https://example.com/0318' },
        },
        '0318-url-refused': {
            run: 'enrich',
            url: { confirmApplies: false },
            meta: { originalUrl: 'https://example.com/0318' },
        },
        '0318-url-missing-field': {
            run: 'enrich',
            url: { missingField: true },
            meta: { originalUrl: 'https://example.com/0318' },
        },
        '0318-checked-agreement': {
            run: 'enrich',
            original: { agreementChecked: true },
            meta: { original: true },
        },
        '0318-measured-settings': {
            run: 'enrich',
            original: {},
            reward: { account: '' },
            claim: {},
            meta: { original: true, reward: true, author: '冰原奔狼', claimSource: '个人观点，仅供参考' },
        },
        '0318-unavailable-stance': {
            run: 'enrich',
            claim: { unavailable: true },
            meta: { claimSource: '个人观点，仅供参考' },
        },
        // AC4+: every requested setting is already committed — no row opens, no warning, no toggle-off.
        'settings-committed-skip': {
            run: 'enrich',
            original: { committed: true },
            reward: { committed: true, account: '平台预设' },
            claim: { committed: true, text: '个人观点，仅供参考' },
            meta: { original: true, reward: true, author: '冰原奔狼', claimSource: '个人观点，仅供参考' },
        },
        // AC4−: 确定 without applying → the residual modal is named, the 未生效 default never lies.
        'settings-fail-named-warning': {
            run: 'enrich',
            original: { confirmApplies: false },
            meta: { original: true },
        },
        // AC4 regression: the account readback is a locator (native-CSS evaluate never sees `:visible`).
        'reward-native-readback': {
            run: 'enrich',
            reward: { committed: false, account: '' },
            meta: { reward: true, author: '冰原奔狼' },
        },
        // AC3+: an exact (whitespace/NBSP-normalized) material is reused — ticked, never re-uploaded.
        'audio-exact-reuse': {
            run: 'audio',
            audio: { rows: [{ title: ' 每日 AI 资讯 ', mediaId: 'media-9' }] },
            title: '每日  AI 资讯',
        },
        // AC3−: only a prefix match exists → named warning, no arbitrary selection, no upload.
        'audio-prefix-warn': {
            run: 'audio',
            audio: { rows: [{ title: '每日 AI 资讯 第 1 期', mediaId: 'media-5' }] },
            title: '每日 AI 资讯',
        },
        // AC3−: two exact rows → ambiguous, refused instead of first-item.
        'audio-duplicate-warn': {
            run: 'audio',
            audio: {
                rows: [
                    { title: '每日 AI 资讯', mediaId: 'media-3' },
                    { title: '每日 AI 资讯', mediaId: 'media-4' },
                ],
            },
            title: '每日 AI 资讯',
        },
        // AC2+: scoped hidden file inputs (the unrelated modal's audio input must stay untouched),
        // delayed committed row after 保存, service-rules ack, title fill.
        'audio-upload-scoped-inputs': {
            run: 'audio',
            audio: { uploadForm: true, delayRowMs: 600 },
            title: '上传的新音频',
        },
        // AC2−: 插入 succeeds but the body node never appears → VERIFY fails the step (never success).
        'audio-verify-unknown': {
            run: 'audio',
            audio: { rows: [{ title: '每日 AI 资讯', mediaId: 'media-11' }], silentDrop: true },
            title: '每日 AI 资讯',
        },
        // AC5−: an unclosable overlay stays open — both steps carry named residual diagnostics.
        'unclosable-overlay': {
            run: 'enrich',
            original: { confirmApplies: false, closable: false },
            claim: { confirmApplies: false },
            meta: { original: true, claimSource: '个人观点，仅供参考' },
        },
        // AC5+: a closable failed dialog is released before the dependent claim step (which succeeds).
        'closable-failure-releases': {
            run: 'enrich',
            original: { confirmApplies: false },
            claim: { confirmApplies: true },
            meta: { original: true, claimSource: '个人观点，仅供参考' },
        },
    };
    const cfg = configs[scenario];
    if (!cfg) throw new Error(`unknown scenario: ${scenario}`);

    const tmp = await mkdtemp(join(tmpdir(), 'kk-dom-fixture-'));
    try {
        const audioPath = join(tmp, 'sample.mp3');
        const coverPath = join(tmp, 'cover.png');
        await writeFile(audioPath, Buffer.from('ID3 fake mp3'));
        await writeFile(coverPath, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));

        const browser = await chromium.launch({ headless: true });
        try {
            const context = await browser.newContext();
            await context.route('**/*', (route) => route.abort());
            const page = await context.newPage();
            await page.setContent(
                `<!doctype html><html><head><meta charset="utf-8"></head><body>${SETTINGS_HTML}</body></html>`,
            );
            // Pre-set committed state before any production probe runs. A string evaluate cannot
            // take an argument — the values are inlined as JSON.
            const preset = [
                cfg.original?.committed
                    ? "document.querySelector('[data-original-empty]').style.display = 'none'; document.querySelector('#js_original_open').style.display = 'block';"
                    : '',
                cfg.reward?.committed ? "document.querySelector('.js_reward_setting_checkbox').checked = true;" : '',
                cfg.claim?.committed
                    ? `document.querySelector('.js_claim_source_selected').textContent = ${JSON.stringify(cfg.claim.text ?? '')};
                       document.querySelector('.js_claim_source').checked = true;`
                    : '',
            ]
                .filter((line) => line !== '')
                .join('\n');
            if (preset !== '') await page.evaluate(`(() => { ${preset} })()`);
            // The wiring runs once per scenario with the whole config as its literal argument.
            await page.evaluate(`(${WIRE})(${JSON.stringify(cfg)})`);

            const wrapped = wrapPlaywrightPage(page);
            let warnings: string[] = [];
            let audioResult: string | undefined;
            if (cfg.run === 'enrich') {
                warnings = await enrichArticle(wrapped, cfg.meta ?? {});
            } else {
                audioResult = await insertAudioMaterial(wrapped, {
                    title: cfg.title ?? '',
                    audioPath,
                    coverPath,
                });
            }
            const ops = (await page.evaluate(COLLECT)) as NonNullable<Facts['ops']>;
            await browser.close();
            return { scenario, warnings, ops: { ...ops, audioResult } };
        } finally {
            await browser.close().catch(() => {});
        }
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
}

const scenario = process.argv[2] ?? '';
runScenario(scenario)
    .then((facts) => {
        // Last line of stdout is the machine contract for the bun:test driver.
        console.log(JSON.stringify(facts));
    })
    .catch((error: unknown) => {
        console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
        process.exit(1);
    });
