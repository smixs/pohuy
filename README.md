<h1 align="center">пиздец</h1>

<p align="center">
  <strong>зачем тебе весь словарь, когда есть четыре корня</strong>
</p>

<p align="center">
  Скилл для Claude Code и других агентов. Тот же ответ, та же точность.<br>
  Наконец-то с первого слова понятно, работает оно — или насколько всё плохо.
</p>

<p align="center"><sub>18+ · мат идиоматический, не машинный · вдохновлено <a href="https://github.com/JuliusBrussee/caveman">caveman</a></sub></p>

---

Русский мат — генеративная морфология: четыре корня плюс приставки и суффиксы
порождают полный технический словарь. Caveman экономит слова. Пиздец экономит корни.
Одно «наебнулось» — это "the service has unexpectedly crashed and requires
investigation", только сразу ясно, что чувствует дежурный.

## До / После

<table>
<tr>
<th width="50%">🗣️ Обычный агент</th>
<th width="50%">🚬 Пиздец</th>
</tr>
<tr>
<td valign="top">

> The deployment failed because the DATABASE_URL environment variable is empty, which caused the database connection to be refused. I recommend checking your environment configuration.

</td>
<td valign="top">

> Деплой наебнулся: `DATABASE_URL` пустой. Хуйня вопрос, чиню.

</td>
</tr>
<tr>
<td valign="top">

> I'd be happy to help! The issue you're experiencing is most likely caused by your authentication middleware not properly validating the token expiry. Let me take a look and suggest a fix.

</td>
<td valign="top">

> Наебнулась auth middleware: expiry проверяется через `<` вместо `<=`. Хуяк:

</td>
</tr>
</table>

Тот же фикс. Ничего технического не потеряно. Всё человеческое — приобретено.

```
┌──────────────────────────────────────────────┐
│  токенов сэкономлено      ░░░░░░░░░       0% │
│  корней использовано      ░░░░░░░░░        4 │
│  техническая точность     █████████     100% │
│  ясность масштаба беды    █████████     100% │
│  душевность               █████████      +∞  │
└──────────────────────────────────────────────┘
```

Цифры честные, см. [ЧЕСТНЫЕ-ЦИФРЫ.md](./ЧЕСТНЫЕ-ЦИФРЫ.md). Спойлер: токенов не экономит ни хуя.

## Установка

```bash
# Claude Code — плагин
claude plugin marketplace add smixs/pizdec && claude plugin install pizdec@pizdec

# Cursor / Codex / Windsurf и прочие — через skills registry
npx skills add smixs/pizdec
```

**Включить:** `/pizdec` или скажи «говори матом». **Выключить:** «нормальный режим».

## Выбери калибр

Три уровня. Переключение: `/pizdec <уровень>`. Держится до конца сессии.

| Уровень | Та же мысль |
|---|---|
| *обычный агент* | You should wrap the object in `useMemo`, since a new reference is created on every render. |
| `lite` | Оберни в `useMemo`: новый ref на каждый рендер, вот оно и перерисовывается. Отъебётся. |
| `full` *(default)* | Хуйня вопрос: inline-объект = новый ref = ре-рендер. `useMemo` — и не еби мозг. |
| `ultra` | Ну ёб твою мать, классика. Inline-объект в пропсы — новый ref каждый рендер, хуяк-хуяк и перерисовка. `useMemo` въеби и живи спокойно. |

## Что внутри

- Словарь-калибровка: ~30 идиом от «пиздрик» до «полный пиздец», чтобы модель
  говорила как живой человек, а не как гуглтранслейт с приправой.
- Железные правила: код, коммиты, PR и доки — чисто; мат на баги, никогда на тебя;
  на security-предупреждениях и `DROP TABLE` — без шуток.
- Присказки на кульминациях: «хуяк вы слушали маяк», «хуйня-хуяня», «опа-хуёпа».

## Как это работает

1. Установка кладёт скилл в агента.
2. Скилл говорит агенту: техника байт в байт, подача — как у инженера с двадцатилетним стажем у курилки.
3. Всё. Никаких хуков, статистик и дашбордов. Аутентичность — это когда без телеметрии.

---

<sub>MIT — свободен, как мат в курилке.</sub>
