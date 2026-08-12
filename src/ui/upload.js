/**
 * 불러오기 화면 (§1, §3).
 *
 * 엑셀 여러 개든 zip 하나든 **같은 경로**로 들어온다. 화면에서도 갈라놓지 않는다.
 *
 * 파일을 읽은 뒤 곧바로 저장하지 않고 확인 화면을 한 번 세운다.
 * **고3 년도는 사람이 확정한다** — 추론은 입력란을 미리 채우는 제안일 뿐이다.
 * 한 해 밀린 자료는 겉보기에 멀쩡해서 나중에 알아챌 방법이 없다.
 */

import { el, clear, openDialog, dialogFrame } from './dom.js';

/** 고3 년도를 학년도로. 화면에서 둘을 늘 나란히 보여 준다. */
export const toSchoolYear = (cohortYear) => cohortYear + 1;

/** 사람이 넣을 수 있는 고3 년도의 상식적 범위. */
export function yearLooksSane(value, currentYear) {
  return Number.isInteger(value) && value >= 1990 && value <= currentYear + 1;
}

/**
 * 고른 파일들을 바이트로 읽는다.
 * @param {FileList|File[]} files
 */
export async function readFiles(files) {
  return Promise.all([...files].map(async (file) => ({
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer())
  })));
}

/**
 * 확인 화면을 세우고, 사람이 정한 것을 돌려준다.
 *
 * @param {HTMLDialogElement} dialog
 * @param {{sheets: object[], skipped: object[]}} prepared
 * @param {number} currentYear
 * @returns {Promise<Record<string, {cohortYear: number|null, include: boolean}>|null>} 취소하면 null
 */
export function confirmUploads(dialog, prepared, currentYear) {
  return new Promise((resolve) => {
    /** @type {Map<string, {cohortYear: number|null, include: boolean}>} */
    const decisions = new Map(prepared.sheets.map((sheet) => [
      sheet.id,
      { cohortYear: sheet.yearGuess.cohortYear, include: true }
    ]));

    const finish = (value) => { dialog.close(); resolve(value); };

    /** 넣을 수 있는 상태인지. 넣기로 한 시트마다 프로파일과 연도가 있어야 한다. */
    function blockers() {
      const problems = [];
      for (const sheet of prepared.sheets) {
        const decision = decisions.get(sheet.id);
        if (!decision.include) continue;
        if (!sheet.profile) { problems.push(`${sheet.fileName}: 열 구성을 알아보지 못했습니다`); continue; }
        // 여러 해가 섞인 누적 파일은 행마다 연도가 실려 있어 파일 연도가 없어도 된다
        const perRowYear = sheet.profile.columns.sourceYear !== undefined && Boolean(sheet.profile.yearBasis);
        if (decision.cohortYear === null && !perRowYear) {
          problems.push(`${sheet.fileName}: 고3 년도를 넣어 주세요`);
        }
      }
      return problems;
    }

    let footerNote;
    let submitButton;

    function refreshFooter() {
      const problems = blockers();
      const chosen = [...decisions.values()].filter((decision) => decision.include).length;
      submitButton.disabled = problems.length > 0 || chosen === 0;
      footerNote.textContent = problems.length > 0
        ? problems[0]
        : `${chosen}장을 불러옵니다.`;
      footerNote.className = problems.length > 0
        ? 'mr-auto text-base font-medium text-fail'
        : 'mr-auto text-base text-ink-soft';
    }

    function sheetCard(sheet) {
      const decision = decisions.get(sheet.id);
      const guess = sheet.yearGuess;

      const yearEcho = el('p', { class: 'mt-2 text-sm text-ink-soft' });
      const yearInput = el('input', {
        class: 'field mt-1 min-h-12 w-40 text-center text-lg num',
        attrs: {
          type: 'number', min: 1990, max: currentYear + 1, step: 1,
          placeholder: '예: 2025',
          value: guess.cohortYear ?? '',
          'aria-label': `${sheet.fileName}의 고3 년도`
        },
        on: {
          input: (event) => {
            const raw = event.target.value.trim();
            const value = raw === '' ? null : Number(raw);
            decision.cohortYear = value !== null && yearLooksSane(value, currentYear) ? value : null;
            echoYear();
            refreshFooter();
          }
        }
      });

      const perRowYear = sheet.profile?.columns?.sourceYear !== undefined && Boolean(sheet.profile?.yearBasis);

      function echoYear() {
        if (decision.cohortYear !== null) {
          // 학년도와 고3 년도를 나란히 보여 준다. 이 둘을 섞는 것이 가장 큰 혼란의 원인이다
          yearEcho.textContent = `${decision.cohortYear}년에 고3 → ${toSchoolYear(decision.cohortYear)}학년도 (${toSchoolYear(decision.cohortYear)}학번)`;
          yearEcho.className = 'mt-2 text-sm text-ink-soft';
          return;
        }
        // 행마다 연도가 실린 파일은 비워 두는 것이 정상이다. 빨갛게 재촉하면 안 될 값을 넣게 만든다
        yearEcho.textContent = perRowYear
          ? '비워 두었습니다 — 행에 실린 연도를 그대로 씁니다.'
          : '고3이었던 달력 연도를 넣어 주세요.';
        yearEcho.className = perRowYear
          ? 'mt-2 text-sm text-ink-soft'
          : 'mt-2 text-sm font-medium text-fail';
      }
      echoYear();

      return el('section', { class: 'card px-5 py-4' }, [
        el('div', { class: 'flex flex-wrap items-start gap-3' }, [
          el('label', { class: 'flex min-h-11 cursor-pointer items-center gap-3' }, [
            el('input', {
              class: 'size-5 accent-brand',
              attrs: { type: 'checkbox', checked: decision.include, 'aria-label': `${sheet.fileName} 불러오기` },
              on: {
                change: (event) => { decision.include = event.currentTarget.checked; refreshFooter(); }
              }
            }),
            el('span', { class: 'min-w-0' }, [
              el('span', { class: 'block truncate text-lg font-semibold', text: sheet.fileName }),
              el('span', {
                class: 'block text-sm text-ink-soft',
                text: [
                  sheet.container ? `${sheet.container} 안` : null,
                  `시트 ${sheet.sheetName}`,
                  `${sheet.rowCount}행`
                ].filter(Boolean).join(' · ')
              })
            ])
          ]),

          el('div', { class: 'ml-auto flex items-center gap-2' }, [
            sheet.profile
              ? el('span', { class: 'tag tag-pass', text: `${sheet.profile.programLabel ?? sheet.profile.id} 양식` })
              : el('span', { class: 'tag tag-fail', text: '열 구성을 알아보지 못함' }),
            sheet.duplicate ? el('span', { class: 'tag tag-wait', text: '이미 불러온 파일' }) : null
          ])
        ]),

        sheet.duplicate
          ? el('p', { class: 'mt-3 rounded-xl bg-wait-soft px-4 py-2 text-base text-wait' }, [
              `같은 내용을 이미 불러왔습니다. 다시 넣으면 그 파일이 넣었던 기록을 갈아 끼웁니다 — 건수가 두 배로 늘지는 않습니다.`
            ])
          : null,

        !sheet.profile
          ? el('p', { class: 'mt-3 rounded-xl bg-fail-soft px-4 py-2 text-base text-fail' }, [
              '어느 열이 무엇인지 알 수 없어 넣지 않습니다. 헤더가 바뀐 새 양식이라면 프로파일을 추가해야 합니다.'
            ])
          : null,

        perRowYear
          ? el('div', { class: 'mt-4 rounded-xl bg-brand-soft px-4 py-3' }, [
              el('p', { class: 'text-base font-medium text-brand', text: '이 파일은 행마다 연도가 실려 있습니다.' }),
              el('p', { class: 'mt-1 text-sm text-ink-soft', text: '비워 두면 행의 연도를 그대로 씁니다. 값을 넣으면 파일 전체를 그 해로 봅니다.' }),
              yearInput, yearEcho
            ])
          : el('div', { class: 'mt-4' }, [
              el('label', { class: 'text-base font-semibold', text: '고3 년도' }),
              guess.explanation
                ? el('p', { class: 'mt-1 text-sm text-ink-soft', text: guess.explanation })
                : el('p', { class: 'mt-1 text-sm text-ink-soft', text: '파일에서 연도를 찾지 못했습니다. 직접 넣어 주세요.' }),
              yearInput, yearEcho
            ])
      ]);
    }

    const body = el('div', { class: 'space-y-4' }, [
      prepared.skipped.length > 0
        ? el('section', { class: 'card border-wait/40 bg-wait-soft px-5 py-4' }, [
            el('h3', { class: 'text-base font-semibold text-wait', text: `건너뛴 파일 ${prepared.skipped.length}개` }),
            el('ul', { class: 'mt-2 space-y-1 text-base text-ink-soft' },
              prepared.skipped.map((item) => el('li', { text: `${item.name} — ${item.reason}` })))
          ])
        : null,
      ...prepared.sheets.map(sheetCard),
      prepared.sheets.length === 0
        ? el('p', { class: 'py-8 text-center text-lg text-ink-soft', text: '읽을 수 있는 시트가 없습니다.' })
        : null
    ]);

    footerNote = el('p', { class: 'mr-auto text-base text-ink-soft' });
    submitButton = el('button', {
      class: 'btn btn-primary', text: '불러오기', attrs: { type: 'button' },
      on: {
        click: () => finish(Object.fromEntries(
          [...decisions].map(([id, decision]) => [id, { ...decision }])
        ))
      }
    });

    openDialog(dialog, dialogFrame({
      title: '불러올 자료를 확인해 주세요',
      note: '고3 년도는 사람이 확정합니다. 아래 값은 파일에서 읽어 낸 제안일 뿐입니다.',
      body,
      onClose: () => finish(null),
      footer: el('div', { class: 'flex w-full items-center gap-3' }, [
        footerNote,
        el('button', {
          class: 'btn', text: '취소', attrs: { type: 'button' },
          on: { click: () => finish(null) }
        }),
        submitButton
      ])
    }));

    dialog.addEventListener('close', () => resolve(null), { once: true });
    refreshFooter();
  });
}

/**
 * 끌어다 놓기와 파일 고르기를 한 곳으로 모은다.
 *
 * @param {object} options
 * @param {HTMLElement} options.zone
 * @param {HTMLInputElement} options.input
 * @param {HTMLElement[]} options.triggers 누르면 파일 고르기가 열리는 것들
 * @param {(files: File[]) => void} options.onFiles
 */
export function bindDropzone({ zone, input, triggers = [], onFiles }) {
  const highlight = (on) => zone?.classList.toggle('border-brand', on);

  for (const trigger of triggers) {
    trigger.addEventListener('click', () => input.click());
  }
  input.addEventListener('change', () => {
    if (input.files?.length) onFiles([...input.files]);
    // 같은 파일을 연달아 고를 수 있어야 한다
    input.value = '';
  });

  // 창 어디에 떨어뜨려도 받는다. 좁은 사각형을 정확히 맞추라고 요구하지 않는다
  for (const target of [zone, document.body].filter(Boolean)) {
    target.addEventListener('dragover', (event) => { event.preventDefault(); highlight(true); });
    target.addEventListener('dragleave', () => highlight(false));
    target.addEventListener('drop', (event) => {
      event.preventDefault();
      highlight(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) onFiles(files);
    });
  }
}
