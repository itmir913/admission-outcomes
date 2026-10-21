/**
 * 불러오기 화면 (§1, §3).
 *
 * 엑셀 여러 개든 zip 하나든 **같은 경로**로 들어온다. 화면에서도 나누지 않는다.
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
 * 선택한 파일들을 바이트로 읽는다.
 * @param {FileList|File[]} files
 */
export async function readFiles(files) {
  return Promise.all([...files].map(async (file) => ({
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer())
  })));
}

/**
 * 이 시트가 파일 단위 고3 년도를 요구하는지.
 *
 * 여러 해가 섞인 누적 파일은 행마다 연도가 실려 있어 파일 연도가 없어도 된다.
 *
 * @param {object} sheet
 */
export function needsFileYear(sheet) {
  // 판단은 prepare 단계가 이미 내려 두었다. 화면이 따로 셈하면 둘이 어긋난다
  return !sheet?.reading?.perRowYear;
}

/**
 * 지금 상태로 불러올 수 없는 이유들.
 *
 * **넣지 않기로 한 시트는 아무것도 막지 않는다.** 체크를 끈 시트의 문제가 단추를
 * 잠그면, 사람은 자기가 선택한 것이 멀쩡한데도 왜 안 되는지 알 길이 없다.
 * 읽지 못한 시트를 섞어 올리는 일은 드물지 않아서, 이 구멍은 반드시 밟힌다.
 *
 * 화면을 그리지 않고 따로 셈한다 — 화면이 바뀌어도 이 규칙은 그대로여야 한다.
 *
 * @param {object[]} sheets
 * @param {Map<string, {cohortYear: number|null, include: boolean}>|Record<string, object>} decisions
 * @returns {string[]} 사람이 읽을 이유. 막을 것이 없으면 빈 배열
 */
export function uploadBlockers(sheets, decisions) {
  const lookup = decisions instanceof Map
    ? (id) => decisions.get(id)
    : (id) => decisions[id];

  const problems = [];
  for (const sheet of sheets ?? []) {
    const decision = lookup(sheet.id);
    if (!decision?.include) continue;
    if (!sheet.reading?.readable) {
      problems.push(`${sheet.fileName}: 대학명 열을 찾지 못했습니다`);
      continue;
    }
    if (decision.cohortYear === null && needsFileYear(sheet)) {
      problems.push(`${sheet.fileName}: 고3 년도를 넣어 주세요`);
    }
  }
  return problems;
}

/**
 * 넣기로 한 시트 수. 하나도 없으면 불러올 것이 없다.
 *
 * @param {object[]} sheets
 * @param {Map<string, {include: boolean}>|Record<string, object>} decisions
 */
export function chosenCount(sheets, decisions) {
  const lookup = decisions instanceof Map
    ? (id) => decisions.get(id)
    : (id) => decisions[id];
  return (sheets ?? []).filter((sheet) => lookup(sheet.id)?.include).length;
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
    /**
     * @type {Map<string, {cohortYear: number|null, include: boolean}>}
     *
     * **읽지 못한 시트는 꺼진 채로 시작한다.** 켜 둬 봐야 불러올 수 없는데,
     * 켜져 있으면 그것이 단추를 잠그고 사람은 멀쩡한 자기 파일을 의심하게 된다.
     */
    const decisions = new Map(prepared.sheets.map((sheet) => [
      sheet.id,
      { cohortYear: sheet.yearGuess.cohortYear, include: Boolean(sheet.reading?.readable) }
    ]));

    const finish = (value) => { dialog.close(); resolve(value); };

    let footerNote;
    let submitButton;

    function refreshFooter() {
      const problems = uploadBlockers(prepared.sheets, decisions);
      const chosen = chosenCount(prepared.sheets, decisions);
      submitButton.disabled = problems.length > 0 || chosen === 0;
      footerNote.textContent = problems.length > 0
        ? problems[0]
        : chosen === 0
          ? '불러올 시트를 하나 이상 선택해 주세요.'
          : `${chosen}장을 불러옵니다.`;
      footerNote.className = problems.length > 0 || chosen === 0
        ? 'mr-auto text-base font-medium text-fail'
        : 'mr-auto text-base text-ink-soft';
    }

    function sheetCard(sheet) {
      const decision = decisions.get(sheet.id);
      const guess = sheet.yearGuess;

      const yearEcho = el('p', { class: 'mt-2 text-base text-ink-soft' });
      const yearInput = el('input', {
        class: 'field mt-1 min-h-12 w-40 text-center text-lg figure',
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

      const reading = sheet.reading;
      const perRowYear = !needsFileYear(sheet);

      function echoYear() {
        if (decision.cohortYear !== null) {
          // 학년도와 고3 년도를 나란히 보여 준다. 이 둘을 섞는 것이 가장 큰 혼란의 원인이다
          yearEcho.textContent = `${decision.cohortYear}년에 고3 → ${toSchoolYear(decision.cohortYear)}학년도 (${toSchoolYear(decision.cohortYear)}학번)`;
          yearEcho.className = 'mt-2 text-base text-ink-soft';
          return;
        }
        // 행마다 연도가 실린 파일은 비워 두는 것이 정상이다. 빨갛게 재촉하면 안 될 값을 넣게 만든다
        yearEcho.textContent = perRowYear
          ? '비워 두었습니다 — 행에 실린 연도를 그대로 씁니다.'
          : '고3이었던 달력 연도를 넣어 주세요.';
        yearEcho.className = perRowYear
          ? 'mt-2 text-base text-ink-soft'
          : 'mt-2 text-base font-medium text-fail';
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
                class: 'block text-base text-ink-soft',
                text: [
                  sheet.container ? `${sheet.container} 안` : null,
                  `시트 ${sheet.sheetName}`,
                  `${sheet.rowCount}행`
                ].filter(Boolean).join(' · ')
              })
            ])
          ]),

          el('div', { class: 'ml-auto flex items-center gap-2' }, [
            // 상태가 셋이다. 어떻게 읽어 냈는지에 따라 사람이 할 일이 다르다
            !reading?.readable
              ? el('span', { class: 'tag tag-fail', text: '대학명 열을 찾지 못함' })
              : reading.source === 'profile'
                ? el('span', { class: 'tag tag-pass', text: `${reading.label} 양식` })
                : el('span', { class: 'tag tag-wait', text: '이름으로 알아냄' }),
            sheet.duplicate ? el('span', { class: 'tag tag-wait', text: '이미 불러온 파일' }) : null
          ])
        ]),

        sheet.duplicate
          ? el('p', { class: 'mt-3 rounded-lg bg-wait-soft px-4 py-2 text-base text-wait' }, [
              `같은 내용을 이미 불러왔습니다. 다시 넣으면 그 파일이 넣었던 기록을 갈아 끼웁니다 — 건수가 두 배로 늘지는 않습니다.`
            ])
          : null,

        !reading?.readable
          ? el('p', { class: 'mt-3 rounded-lg bg-fail-soft px-4 py-2 text-base text-fail' }, [
              '대학명 열을 찾지 못해 체크를 꺼 두었습니다. 나머지만 불러오면 됩니다. 대학 이름이 든 열의 머리글을 「대학명」으로 고쳐 다시 올리면 해석됩니다.'
            ])
          : null,

        /*
         * 이름으로 해석한 시트는 **한 번은 눈으로 보게 한다.**
         * 맞게 풀렸을 가능성이 높지만, 틀렸을 때 틀린 티가 안 나는 쪽이라 그렇다.
         */
        reading?.readable && reading.source === 'names'
          ? el('div', { class: 'mt-3 rounded-lg bg-wait-soft px-4 py-3 text-base text-wait' }, [
              el('p', { class: 'font-semibold', text: '등록된 양식과 달라 열 이름으로 해석했습니다. 한 번 확인해 주세요.' }),
              el('p', { class: 'mt-1 text-base' , text: `열 ${reading.columnCount}개 중 ${Object.keys(reading.columns).length}개를 해석했습니다.` }),
              reading.unresolved.length > 0
                ? el('p', {
                    class: 'mt-1 text-base',
                    text: `해석하지 못한 ${reading.unresolved.length}개는 원본 이름 그대로 보존합니다 — ${reading.unresolved.slice(0, 6).map((item) => item.label).join(', ')}${reading.unresolved.length > 6 ? ' …' : ''}`
                  })
                : null,
              ...reading.notes.map((note) => el('p', { class: 'mt-1 text-base', text: note }))
            ])
          : null,

        perRowYear
          ? el('div', { class: 'mt-4 rounded-lg bg-brand-soft px-4 py-3' }, [
              el('p', { class: 'text-base font-medium text-brand', text: '이 파일은 행마다 연도가 실려 있습니다.' }),
              el('p', { class: 'mt-1 text-base text-ink-soft', text: '비워 두면 행의 연도를 그대로 씁니다. 값을 넣으면 파일 전체를 그 해로 봅니다.' }),
              yearInput, yearEcho
            ])
          : el('div', { class: 'mt-4' }, [
              el('label', { class: 'text-base font-semibold', text: '고3 년도' }),
              guess.explanation
                ? el('p', { class: 'mt-1 text-base text-ink-soft', text: guess.explanation })
                : el('p', { class: 'mt-1 text-base text-ink-soft', text: '파일에서 연도를 찾지 못했습니다. 직접 넣어 주세요.' }),
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
 * 끌어다 놓기와 파일 선택을 한 곳으로 모은다.
 *
 * @param {object} options
 * @param {HTMLElement} options.zone
 * @param {HTMLInputElement} options.input
 * @param {HTMLElement[]} options.triggers 누르면 파일 선택이 열리는 것들
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
