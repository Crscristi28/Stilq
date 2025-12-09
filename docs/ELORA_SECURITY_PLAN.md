# Elora Security Layer - Plan

## Koncept

Využít router jako inteligentní security layer místo keyword matching.

## Architektura

```
Router (Flash Lite)
  ├── gemini-2.5-flash (default)
  ├── gemini-3-pro-preview (complex)
  ├── image-agent (generace/editace)
  └── elora-security (harmful content)
```

## Proč je to lepší než keyword blocking

| Keyword Matching | LLM Router Security |
|------------------|---------------------|
| Snadno obejít (h0w t0 m4ke b0mb) | Chápe záměr a kontext |
| Hodně false positives | Rozumí nuancím |
| Jen blokuje, nevysvětluje | Educational response |
| Statické pravidla | Adaptivní |

## Jak to funguje

1. **Router detekuje harmful content** - přidáme do promptu kategorii "SECURITY STRATEGY"
2. **Route to `elora-security`** - místo hard blocku
3. **Elora Security agent odpovídá** - vysvětluje proč je request problematický
4. **Varování + možný ban** - při opakovaných pokusech

## Kategorie harmful contentu

- CSAM (child sexual abuse material)
- Non-consensual intimate imagery (deepfakes, revenge porn)
- Violence/gore requests
- Weapons/explosives instructions
- Drug manufacturing
- Fraud/scam assistance
- Hate speech generation

## Elora Security Response

Agent by měl:
- Vysvětlit PROČ je request problematický (educational)
- Zmínit jaké pravidla to porušuje
- Varovat že další pokusy = dočasný ban
- Být profesionální, ne judgmental
- Nabídnout alternativu pokud existuje legitimní verze dotazu

## Implementace (TODO)

### 1. Router Prompt Update
Přidat do router.ts:
```
**4. SECURITY STRATEGY: "elora-security"**
Route to elora-security for requests involving:
- Explicit sexual content with real people
- CSAM or content sexualizing minors
- Non-consensual intimate imagery
- Detailed instructions for weapons/explosives/drugs
- Fraud, scams, or illegal activities
```

### 2. Security Prompt
Vytvořit `prompts/security.ts` s promptem pro Elora Security agent.

### 3. Handler v index.ts
Přidat handler pro `elora-security` target model.

### 4. Rate Limiting (optional)
Sledovat počet security hits per user → dočasný ban po X pokusech.

## Výhody

1. **Flexibilita** - LLM rozumí kontextu, ne jen keywords
2. **Educational** - user se dozví proč je to špatné
3. **Profesionální** - ne jen "BLOCKED", ale vysvětlení
4. **Centralizované** - vše řeší router na jednom místě
5. **Levné** - router běží na Flash Lite, security response na Flash

## Poznámky

- Router musí být rychlý → Flash Lite stačí pro detekci
- Security response může být cached pro běžné případy
- Logy pro monitoring (bez PII)
