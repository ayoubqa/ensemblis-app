// Curated example reports for the public gallery (v3). Seeded idempotently
// (upsert by slug) with isExample = true and clearly labelled "Example" in the UI.
//
// Every source below was opened and checked during authoring; each [n] in a
// report's content maps to the source with the same n. Figures carry their
// dates; derived numbers are labelled as our calculations in the content.

export interface GallerySource {
  n: number;
  kind: "web" | "wikipedia" | "link" | "upload";
  title: string;
  url: string | null;
  domain: string | null;
  snippet: string;
  publishedAt: string | null;
}

export interface GalleryExample {
  slug: string;
  title: string;
  category: string;
  summary: string; // 1–2 sentences for the card
  agentName: string; // must match a catalog agent name
  depth: "focused" | "standard" | "deep";
  position: number;
  content: string; // markdown report; cites sources inline as [n]
  sources: GallerySource[];
}

// ---------------------------------------------------------------------------
// 1. Competitive landscape — EU motorway fast charging
// ---------------------------------------------------------------------------

const EV_CHARGING: GalleryExample = {
  slug: "eu-highway-fast-charging-competitive-landscape",
  title: "EU Highway Fast-Charging Networks: Competitive Landscape 2026",
  category: "Research",
  summary:
    "How Tesla, IONITY, Fastned and Allego compete on Europe's motorways now that EU rules (AFIR) standardise payment, pricing and minimum power, and where a new entrant could still win.",
  agentName: "Competitive Intelligence Agent",
  depth: "deep",
  position: 1,
  content: `# EU Highway Fast-Charging Networks: Competitive Landscape 2026

**Scope:** public high-power charging on European motorways (Tesla Supercharger, IONITY, Fastned and Allego) plus the regulatory baseline. Prepared for a company weighing entry into, or a partnership in, motorway fast charging.

## Executive summary

- **Demand is growing from a modest base.** Battery-electric cars took 17.4% of new EU car registrations in 2025 (1,880,370 cars), up from 13.6% in 2024 [10].
- **Regulation now sets a common floor.** The Alternative Fuels Infrastructure Regulation (AFIR) has applied since 13 April 2024 [9]. On the TEN-T core road network it requires charging pools every 60 km with at least 400 kW per pool by the end of 2025, rising to 600 kW by the end of 2027, plus card payment and per-kWh price display at chargers of 50 kW or more [8].
- **Two scale players set the pace.** Tesla had more than 1,350 European Supercharger sites as of July 2024 and began opening the network to other brands with Dutch trials in 2021 [5]; carmaker joint venture IONITY describes itself as running over 700 stations in 24 countries [2].
- **Fastned is the clearest economic benchmark.** It ended 2025 with 406 stations in nine countries and roughly €335,000 of revenue per station, and targets 1,000 stations by 2030 [4], but it has never turned a profit at group level [3].
- **The opening for a newcomer is not "another national network".** Once payment and pricing are standardised by law, the durable advantages are site access, grid capacity, uptime and partnerships.

## Market context: demand and the regulatory floor

Demand is still early: fewer than one in five new cars registered in the EU in 2025 was battery-electric [10]. AFIR matters more for strategy, because it turns former differentiators into legal obligations.

| AFIR obligation (cars and vans) | What it requires | Source |
|---|---|---|
| Corridor coverage | A charging pool at least every 60 km on the TEN-T core network, by 31 Dec 2025 | [8] |
| Pool power, step 1 | At least 400 kW per pool, including at least one point of 150 kW or more (by 31 Dec 2025) | [8] |
| Pool power, step 2 | At least 600 kW per pool, including at least two points of 150 kW or more (by 31 Dec 2027) | [8] |
| Ad hoc payment | Card payment at points of 50 kW or more; no subscription needed to charge | [7][8] |
| Price transparency | Ad hoc price per kWh displayed at points of 50 kW or more | [8] |
| Fleet-based target | At least 1.3 kW of public charging power per registered battery-electric car | [9] |

Operators must also give consumers electronic information on availability, waiting times and prices [7]. Drivers can now pay by card and compare prices at any compliant fast charger, weakening app and subscription lock-in.

## Player profiles

| Network | Ownership and model | Scale (date) | Notable facts |
|---|---|---|---|
| Tesla Supercharger | Carmaker-owned, vertically integrated | 1,350+ European sites (Jul 2024); 7,900 stations and 75,000+ connectors worldwide (Nov 2025) [5] | Began charging non-Tesla cars in the Netherlands in 2021; V4 cabinets deliver up to 500 kW to 800 V vehicles [5] |
| IONITY | Joint venture of BMW, Ford, Hyundai, Mercedes-Benz and Volkswagen Group, with BlackRock's Climate Infrastructure Platform as financial investor [1] | 684 stations and 4,359 points in 24 countries (Oct 2024) [1]; "over 700 stations" per its website (2026) [2] | Up to 400 kW per point; target of 1,000 stations and 9,000 points by 2027, with an additional €600 million loan secured [1]; first urban site opened in London in August 2026 [2] |
| Fastned | Independent; listed on Euronext Amsterdam since June 2019 [3] | 406 stations in nine countries (end of 2025) [4] | Early 15-year permit to build at 201 Dutch motorway rest areas [3]; 2026 guidance of 476–506 stations [4] |
| Allego | Founded in 2013 as a subsidiary of Dutch utility Alliander; sold to infrastructure fund Meridiam in 2018 [6] | Exercised an option in 2022 to buy 100 locations with 770 fast chargers [6] | Current network size should be confirmed directly with the company |

Counts are not like-for-like (sites vs stations vs points) and come from different dates. Tesla and IONITY compete on breadth and carmaker brand pull, Fastned on prime sites, and Allego on infrastructure-fund capital.

## Unit economics: what Fastned's disclosures reveal

Fastned's disclosures are the most granular of the four networks in the sources reviewed, making it the best benchmark:

- **Revenue per station:** about €335,000 in 2025, with 2026 guidance of €350,000–400,000 [4].
- **Growth:** Q4 2025 charging revenue of €38.1 million, up 44% year on year, from 54.8 GWh delivered across more than 2 million sessions [4].
- **Margins:** guidance of a 35–40% operational EBITDA margin, with verified 2025 figures deferred to the annual report [4].
- **Group profitability:** revenue was €60.5 million in 2023 and the company has never turned a profit, which is attributed to its continuing expansion [3].

Derived from [4] (our approximate calculations): Q4 2025 revenue was roughly €0.70 per kWh delivered, and sessions averaged at most about 27 kWh.

## Competitive dynamics and white space

1. **Standardisation compresses differentiation.** With card payment and per-kWh price display mandated [8], reliability, power and amenities carry more weight.
2. **Site access is the moat.** Fastned's early, long-dated rest-area permits [3] show the value of hard-to-replicate locations.
3. **Power keeps escalating.** Tesla's 500 kW V4 [5] and IONITY's 400 kW points [1] sit well above AFIR's 150 kW individual-point threshold [8]; do not plan to the legal minimum.
4. **Boundaries are blurring.** IONITY's first urban site in London [2] shows a motorway specialist moving into denser city markets.
5. **Capacity must track the fleet.** AFIR's 1.3 kW-per-car target [9] makes national obligations rise with the battery-electric fleet.

## Recommendations & next steps

1. **Pick a wedge, not a country.** Target under-served corridor segments or high-traffic destinations where incumbents lack sites.
2. **Lock in sites and grid first;** long-term land rights and grid connections are the primary competitive asset.
3. **Build to the 2027 specification** (600 kW per pool with two 150 kW points [8]) to avoid early retrofits.
4. **Benchmark against Fastned.** Stress-test at €250,000–400,000 of revenue per station (our illustrative downside up to Fastned's 2026 guidance [4]).
5. **Explore partnerships** with carmakers, fleets and landowners; IONITY's shareholder structure [1] shows the value of carmaker alignment.

## Sources & verification notes

- **Verified from official or primary sources:** AFIR obligations [7][8][9]; EU registration data [10]; Fastned's Q4 2025 metrics and guidance [4].
- **From Wikipedia (secondary):** ownership, history and some network counts [1][3][5][6]; confirm against company filings.
- **Company self-description:** IONITY's "over 700 stations" is taken from its website's description [2], accessed October 2026.
- **Estimates and derivations:** revenue per kWh and kWh per session are our calculations; the €250,000 downside is illustrative.
- **Verify before relying on this:** current station counts (they change monthly), Allego's present ownership structure and network size, Fastned's audited 2025 EBITDA margin, and national AFIR compliance by corridor.
`,
  sources: [
    {
      n: 1,
      kind: "wikipedia",
      title: "IONITY",
      url: "https://en.wikipedia.org/wiki/Ionity",
      domain: "en.wikipedia.org",
      snippet:
        "IONITY is a joint venture of BMW, Ford, Hyundai, Mercedes-Benz and Volkswagen Group with BlackRock's Climate Infrastructure Platform as financial investor; it ran 684 stations with 4,359 points in 24 countries by October 2024, offers up to 400 kW per point and targets 1,000 stations and 9,000 points by 2027.",
      publishedAt: null,
    },
    {
      n: 2,
      kind: "web",
      title: "IONITY – Latest news and press releases",
      url: "https://www.ionity.eu/en/ionity/press-releases",
      domain: "www.ionity.eu",
      snippet:
        "IONITY's newsroom; the site describes the network as over 700 charging stations in 24 European countries and lists an August 2026 release on its first urban charging site in London.",
      publishedAt: null,
    },
    {
      n: 3,
      kind: "wikipedia",
      title: "Fastned",
      url: "https://en.wikipedia.org/wiki/Fastned",
      domain: "en.wikipedia.org",
      snippet:
        "Fastned was founded in 2012, received a 15-year permit for charging stations at 201 Dutch rest areas, listed on Euronext Amsterdam on 21 June 2019, reported €60.5 million revenue in 2023 and has never turned a profit due to continuing expansion.",
      publishedAt: null,
    },
    {
      n: 4,
      kind: "web",
      title: "Fastned reports €38.1m revenue in Q4 as charging network scale-up accelerates",
      url: "https://www.fastnedcharging.com/hq/en/fastned-reports-381m-revenue-in-q4-as-charging-network-scale-up-accelerates--/",
      domain: "www.fastnedcharging.com",
      snippet:
        "Fastned's Q4 2025 trading update: €38.1 million charging revenue (+44% year on year), 54.8 GWh over 2 million+ sessions, 406 stations in nine countries, about €335,000 revenue per station in 2025, 2026 guidance and a 1,000-station ambition for 2030.",
      publishedAt: "2026-01-15",
    },
    {
      n: 5,
      kind: "wikipedia",
      title: "Tesla Supercharger",
      url: "https://en.wikipedia.org/wiki/Tesla_Supercharger",
      domain: "en.wikipedia.org",
      snippet:
        "Tesla began charging non-Tesla cars in the Netherlands in 2021, had 1,350+ European sites by July 2024 and 7,900 stations with 75,000+ connectors worldwide by November 2025; V4 cabinets deliver up to 500 kW for 800 V vehicles.",
      publishedAt: null,
    },
    {
      n: 6,
      kind: "wikipedia",
      title: "Allego",
      url: "https://en.wikipedia.org/wiki/Allego",
      domain: "en.wikipedia.org",
      snippet:
        "Allego was founded in September 2013 as a subsidiary of Dutch utility Alliander, was sold to the infrastructure fund Meridiam on 31 May 2018, and in July 2022 exercised a purchase option on 100 locations with 770 fast chargers.",
      publishedAt: null,
    },
    {
      n: 7,
      kind: "web",
      title:
        "Alternative fuels infrastructure: Council adopts new law for more recharging and refuelling stations across Europe",
      url: "https://alternative-fuels-observatory.ec.europa.eu/node/804",
      domain: "alternative-fuels-observatory.ec.europa.eu",
      snippet:
        "Council press release on AFIR's adoption, republished by the European Alternative Fuels Observatory: 150 kW+ fast chargers every 60 km on main TEN-T corridors from 2025, card or contactless payment without a subscription, and electronic information on availability, waiting time and price.",
      publishedAt: "2023-07-26",
    },
    {
      n: 8,
      kind: "web",
      title: "Charging infrastructure in the EU context",
      url: "https://nationale-leitstelle.de/en/charging-infrastructure-in-the-eu-context/",
      domain: "nationale-leitstelle.de",
      snippet:
        "Germany's National Centre for Charging Infrastructure summarises AFIR: on the TEN-T core network, pools every 60 km with 400 kW (one 150 kW point) by end-2025 and 600 kW (two 150 kW points) by end-2027; card payment and per-kWh price display at points of 50 kW or more.",
      publishedAt: null,
    },
    {
      n: 9,
      kind: "web",
      title: "Alternative fuels infrastructure - Mobility and Transport",
      url: "https://transport.ec.europa.eu/transport-themes/clean-transport/alternative-fuels-sustainable-mobility-europe/alternative-fuels-infrastructure_en",
      domain: "transport.ec.europa.eu",
      snippet:
        "European Commission page on Regulation (EU) 2023/1804 (AFIR), applicable since 13 April 2024: fleet-based target of at least 1.3 kW public charging power per battery-electric car, distance-based TEN-T targets and user-friendliness rules on payment and price transparency.",
      publishedAt: null,
    },
    {
      n: 10,
      kind: "web",
      title: "New car registrations: +1.8% in 2025; battery-electric 17.4% market share",
      url: "https://www.acea.auto/pc-registrations/new-car-registrations-1-8-in-2025-battery-electric-17-4-market-share/",
      domain: "www.acea.auto",
      snippet:
        "ACEA reports 1,880,370 new battery-electric cars registered in the EU in 2025, a 17.4% market share, up from 13.6% in 2024.",
      publishedAt: "2026-01-27",
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Market sizing / entry — Spain for a B2B SaaS
// ---------------------------------------------------------------------------

const SPAIN_ENTRY: GalleryExample = {
  slug: "spain-market-entry-b2b-saas",
  title: "Entering Spain with a B2B SaaS: Market-Entry Brief",
  category: "Research",
  summary:
    "Sizes the Spanish opportunity for SME back-office software from official INE and Eurostat data, picks priority segments and regions, and flags the 2027 invoicing-compliance deadlines that create a buying trigger.",
  agentName: "Market Research Agent",
  depth: "standard",
  position: 2,
  content: `# Entering Spain with a B2B SaaS: Market-Entry Brief

**Client profile (assumed):** an EU-based SaaS vendor selling billing and back-office workflow software to small and mid-sized businesses, evaluating Spain as its next market.

## Executive summary

- **A large market made of very small companies.** Spain had 3,310,824 active companies on 1 January 2025 (+1.7% year on year), but 54.4% had no employees and a further 27.2% had only one or two [1].
- **The realistic target is about 608,000 firms with three or more employees** (our calculation from [1]); among employers, only 5.0% have 20 or more staff [1].
- **Cloud adoption trails the EU average.** 44.3% of Spanish companies with 10+ employees paid for cloud services in Q1 2025 [2], versus 52.74% of EU enterprises in 2025 [3]: headroom, but also a sign that education is part of the sale.
- **Regulation creates a 2027 buying trigger.** New invoicing-software (VeriFactu) rules apply from 1 January 2027 for corporate income-tax payers and 1 July 2027 for others [5][6], and mandatory B2B e-invoicing is being phased in under Royal Decree 238/2026 [7].
- **Illustrative obtainable market:** roughly €3–6.5 million ARR within three years at an assumed €1,200 per account per year (estimates, not forecasts).

## Market definition

Spanish businesses with at least three employees that buy subscription software for invoicing, billing and related back-office workflows. Firms with fewer than three staff are excluded from the core target on the assumption that they buy lower-priced tools or rely on their accountants; this assumption should be validated in customer interviews.

## Market size (illustrative)

| Layer | Definition | Calculation | Result |
|---|---|---|---|
| Universe | Active companies, 1 Jan 2025 | INE business directory [1] | 3,310,824 |
| TAM | Companies with 3+ employees | 3,310,824 − 1,800,443 (no employees) − 901,955 (1–2 employees) [1] | ≈ 608,000 firms; ≈ €730m a year at €1,200 per account |
| SAM | TAM firms already paying for cloud services | 608,000 × 44.3% [2] | ≈ 270,000 firms; ≈ €323m a year |
| SOM | Share winnable in about three years | 1–2% of SAM | ≈ 2,700–5,400 accounts; ≈ €3.2–6.5m ARR |

All money values are illustrative estimates. The €1,200 annual contract value and the 1–2% capture rate are assumptions. The 44.3% adoption rate is measured for firms with 10+ employees [2] and probably overstates adoption among firms with 3–9 employees, so treat the SAM as an upper bound.

## Segment analysis

| Segment | Size [1] | Fit | Accessibility | Priority |
|---|---|---|---|---|
| No employees | 1,800,443 | Low: price-sensitive, simple needs | Self-serve only | Exclude at launch |
| 1–2 employees | 901,955 | Low to medium | Via accountants and partners | Later, partner-led |
| 3–19 employees | ≈ 533,000 (derived) | High: enough volume to need workflow tools | Digital plus partners | **Primary** |
| 20+ employees | ≈ 75,000 (derived from the 5.0% share of employers) | High, with more complex needs | Sales-assisted | **Secondary, higher contract value** |

By sector, commerce is the largest group (625,664 firms, 18.9%), followed by professional, scientific and technical activities (416,544, 12.6%) and construction (389,146, 11.8%) [1]. Professional-services firms are a plausible early-adopter vertical for billing software (a hypothesis to test in discovery interviews).

## Regional demand and trends

- **Concentration:** Cataluña (610,062 firms, 18.4%), Andalucía (540,462, 16.3%) and the Comunidad de Madrid (526,588, 15.9%) together hold just over half of Spain's active companies, with the Comunitat Valenciana next at 372,121 [1].
- **Language:** Spanish is the official national language, and Catalan/Valencian, Basque, Galician and Aranese are recognised regional languages [8]. Launch in Spanish and plan Catalan-language marketing for Cataluña.
- **AI interest is rising:** the share of companies with 10+ employees using AI rose 8.7 points to 21.1% in Q1 2025 [2].
- **Public digitalisation funding:** the Kit Digital programme, managed by Red.es and funded by the EU's NextGenerationEU with a €3,067 million budget, offered vouchers of €12,000, €6,000 and €3,000 to firms with 10–49, 3–9 and 0–2 employees for solutions including e-invoicing, customer management and process management, supplied by "agentes digitalizadores" (digitalising agents) [4].
- **Compliance deadlines:** producers of invoicing software have had to offer VeriFactu-adapted systems since 29 July 2025 [5]. Users must comply from 1 January 2027 (corporate income-tax payers) or 1 July 2027 (others), a postponement that Congress validated on 11 December 2025 [5][6]. For B2B e-invoicing, Royal Decree 238/2026 of 25 March phases the obligation in 12 months (turnover above €8 million) or 24 months (all other businesses) after a ministerial order that, as of April 2026, had not yet been approved [7].

## Recommendations & next steps

1. **Lead with compliance.** Make VeriFactu readiness and e-invoicing support the headline proposition for the run-up to the January and July 2027 deadlines [5].
2. **Start in Madrid and Barcelona,** then expand to Valencia and Andalucía; these four regions hold roughly six in ten Spanish companies (our sum from [1]).
3. **Target 3–19 employee professional-services and commerce firms first,** with a sales-assisted motion for accounts of 20+ employees.
4. **Build an accountant and adviser partner channel** to reach the long tail of small firms, and check whether becoming a digitalising agent is worthwhile if Kit Digital-style programmes continue [4].
5. **Localise fully:** Spanish interface, support, contracts and invoice templates, with Catalan marketing where relevant [8].

## Sources & verification notes

- **Verified official statistics:** company counts and size, sector and regional splits [1]; ICT adoption [2][3]. Both INE and Eurostat figures cover enterprises with 10+ employees for the adoption data.
- **Regulatory dates** come from law-firm and advisory summaries [5][6][7], dated December 2025 to April 2026. Confirm with the Spanish Tax Agency (AEAT) and the Official State Gazette (BOE) before launch, especially whether the e-invoicing ministerial order has since been published.
- **Kit Digital** details come from a 2024 government press dossier [4]; whether calls are still open was not verified.
- **Estimates:** all TAM/SAM/SOM money values, the €1,200 price point, capture rates and the 3–19 / 20+ employee splits are our calculations or assumptions.
- **Still to validate:** willingness to pay, competitor pricing (not covered here) and cloud adoption among firms with 3–9 employees.
`,
  sources: [
    {
      n: 1,
      kind: "web",
      title: "Nota de prensa: Directorio Central de Empresas (DIRCE). 1 de enero de 2025",
      url: "https://www.ine.es/dyngs/Prensa/DIRCE2025.htm",
      domain: "www.ine.es",
      snippet:
        "Spain's statistics office reports 3,310,824 active companies on 1 January 2025 (+1.7%), with 1,800,443 having no employees and 901,955 having one or two; among employers, 5.0% had 20+ workers. Includes counts by sector and region.",
      publishedAt: "2025-12-11",
    },
    {
      n: 2,
      kind: "web",
      title:
        "Encuesta sobre el uso de TIC y del comercio electrónico en las empresas. Año 2024 - Primer trimestre 2025",
      url: "https://www.ine.es/dyngs/Prensa/ETICCE20241T2025.htm",
      domain: "www.ine.es",
      snippet:
        "INE's ICT-in-enterprises survey: in Q1 2025, 44.3% of companies with 10+ employees used paid cloud computing and 21.1% used artificial intelligence, up 8.7 points.",
      publishedAt: "2025-10-22",
    },
    {
      n: 3,
      kind: "web",
      title: "Cloud computing - statistics on the use by enterprises",
      url: "https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Cloud_computing_-_statistics_on_the_use_by_enterprises",
      domain: "ec.europa.eu",
      snippet:
        "Eurostat: 52.74% of EU enterprises (10+ employees) used paid cloud computing services in 2025, ranging from 79.21% in Finland to 17.83% in Bulgaria; 49.3% of small and 84.67% of large enterprises.",
      publishedAt: "2026-01",
    },
    {
      n: 4,
      kind: "web",
      title: "Programa Kit Digital – Dossier de prensa",
      url: "https://www.lamoncloa.gob.es/serviciosdeprensa/notasprensa/transformacion-digital-y-funcion-publica/Documents/2024/120624-programa-Kit-Digital.pdf",
      domain: "www.lamoncloa.gob.es",
      snippet:
        "Spanish government press dossier: Kit Digital, managed by Red.es and funded by NextGenerationEU with €3,067 million, gives digital vouchers of €12,000, €6,000 and €3,000 by company size for solutions such as e-invoicing and customer management, supplied by digitalising agents.",
      publishedAt: null,
    },
    {
      n: 5,
      kind: "web",
      title: "Ampliado el plazo para la adaptación de los sistemas informáticos de facturación",
      url: "https://www.cuatrecasas.com/es/spain/fiscalidad/art/rdl15-sistemas-informaticos-facturacion-plazo",
      domain: "www.cuatrecasas.com",
      snippet:
        "Law firm Cuatrecasas explains Royal Decree-law 15/2025: invoicing-system (VeriFactu) obligations move to 1 January 2027 for corporate income-tax payers and 1 July 2027 for other users; software producers' 29 July 2025 deadline is unchanged.",
      publishedAt: "2025-12-03",
    },
    {
      n: 6,
      kind: "web",
      title: "Indirect Tax Newsletter",
      url: "https://www.bdo.es/en-gb/insights/client-advisories/fiscal/vat-newsletter-january-2026",
      domain: "www.bdo.es",
      snippet:
        "BDO Spain's January 2026 newsletter confirms Congress validated Royal Decree-law 15/2025 on 11 December 2025, confirming the postponement of mandatory VeriFactu implementation to 2027.",
      publishedAt: "2026-01-07",
    },
    {
      n: 7,
      kind: "web",
      title: "Aprobado el Reglamento de facturación electrónica obligatoria en operaciones B2B",
      url: "https://www.cuatrecasas.com/es/latam/fiscalidad/art/reglamento-facturacion-electronica-obligatorio-operaciones",
      domain: "www.cuatrecasas.com",
      snippet:
        "Cuatrecasas on Royal Decree 238/2026 of 25 March, which develops mandatory B2B e-invoicing: it applies 12 months (turnover above €8 million) or 24 months (others) after a ministerial order not yet approved at the time of writing.",
      publishedAt: "2026-04-01",
    },
    {
      n: 8,
      kind: "wikipedia",
      title: "Spain",
      url: "https://en.wikipedia.org/wiki/Spain",
      domain: "en.wikipedia.org",
      snippet:
        "Background on Spain: Spanish is the official language at national level, with Aranese, Basque, Catalan/Valencian and Galician recognised as regional languages.",
      publishedAt: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Financial explainer — ASML
// ---------------------------------------------------------------------------

const ASML: GalleryExample = {
  slug: "how-asml-makes-money-2025",
  title: "How ASML Makes Money: A Plain-English Read of Its 2025 Results",
  category: "Finance",
  summary:
    "Breaks down ASML's €32.7 billion of 2025 sales into its two engines, lithography systems and installed-base services, and explains margins, cash returns and what to watch, using the company's own results and annual report.",
  agentName: "Financial Analyst",
  depth: "standard",
  position: 3,
  content: `# How ASML Makes Money: A Plain-English Read of Its 2025 Results

**Purpose:** explain, for a non-specialist reader, where ASML's revenue and profit come from, using its full-year 2025 publications.

## Executive summary

- **Two revenue engines.** ASML generated €32.7 billion of total net sales in 2025: about three-quarters from selling lithography systems and a quarter (€8.2 billion) from servicing and upgrading machines already in the field, which it calls Installed Base Management [1][2].
- **EUV is the growth driver.** EUV system sales rose 39% to €11.6 billion on 48 systems, while DUV system sales fell 6% to €12.0 billion on 279 systems [2].
- **Highly profitable.** Gross margin was 52.8% and net income €9.6 billion, against 51.3% and €7.6 billion in 2024 [1].
- **Heavy reinvestment.** R&D costs were about €4.7 billion in 2025 [3], roughly 14% of sales (our calculation).
- **Cash returns and outlook.** ASML intends a total 2025 dividend of €7.50 per share, has announced a share buyback of up to €12 billion to be executed by the end of 2028, and guides 2026 sales of €34–39 billion at a 51–53% gross margin [1].

## The business in one paragraph

ASML, headquartered in Veldhoven in the Netherlands and founded in 1984 as a joint venture of Philips and ASM International, builds the lithography machines that chipmakers use to print circuit patterns onto silicon wafers [4]. It holds a near-monopoly in extreme-ultraviolet (EUV) lithography, its customers include TSMC, Samsung and Intel, and its shares trade on Euronext Amsterdam and Nasdaq [4].

## Engine 1: selling systems

| Product line (2025) | Net sales | Change vs 2024 | Systems recognised | Average per system (our calc.) |
|---|---|---|---|---|
| EUV systems (NXE and EXE) | €11.6bn | +39% | 48 | ≈ €242m |
| DUV systems | €12.0bn | −6% | 279 | ≈ €43m |
| Metrology & Inspection | €825m | +28% | n/a | n/a |
| **Net system sales** | **≈ €24.5bn** | | | |

Line items from [2]; net system sales derived as total net sales minus Installed Base Management [1].

By end market, Logic chipmakers accounted for €16.1 billion of system sales and Memory makers for €8.4 billion [3]. The EUV average blends the established NXE line with the newer High-NA EXE systems; Wikipedia cites prices of up to about $200 million for an NXE:3600D and roughly $370 million for a High-NA system [4]. ASML says its gross margin benefited from a favourable NXE product mix but was partly diluted by EXE systems recognised in sales [3].

Unit volumes fell even as revenue rose: ASML sold 300 new and 27 used lithography systems in 2025, against 380 new and 38 used in 2024 [1]. The revenue mix shifted towards EUV, whose machines are worth several times more per unit than DUV (see table).

## Engine 2: Installed Base Management

Installed Base Management covers service and "field options", meaning upgrades to machines already installed. It grew 26% to €8.2 billion [2] (€8,193 million against €6,494 million in 2024 [1]). ASML attributes the increase to a growing installed base, higher tool utilisation at certain customers and more NXE field upgrades, and notes that higher service and field-option sales and margins also lifted gross margin [3].

Why it matters (our analysis): every system sold adds to a fleet that needs servicing and upgrading for years, so this line is likely to be steadier than new-system sales, which follow chipmakers' capital-spending cycles.

## Profitability and cash returns

| Metric | 2024 | 2025 |
|---|---|---|
| Total net sales | €28.3bn | €32.7bn |
| Gross margin | 51.3% | 52.8% |
| Net income | €7.6bn | €9.6bn |
| Net margin (our calc.) | ≈ 26.8% | ≈ 29.4% |
| R&D costs | €4.3bn | €4.7bn |

Sales, gross margin and net income from [1]; R&D from [3].

Basic earnings per share were €24.73 in 2025 [1]. ASML intends to declare a total 2025 dividend of €7.50 per share, 17% more than for 2024, including a proposed final dividend of €2.70 [1].

## Risks and what to watch

- **Customer dependence:** major customers include TSMC, Samsung and Intel [4], so orders depend heavily on a few large chipmakers' investment plans. Q4 2025 net bookings were €13.2 billion, of which €7.4 billion was EUV [1].
- **Geopolitics:** the Dutch government placed restrictions on chip-equipment exports in March 2023, with further restrictions since [4]. Even so, ASML reported that its 2025 DUV business in China was stronger than anticipated [3].
- **AI demand:** management said many customers had become notably more positive about the medium term, mainly because of more robust expectations that AI-related demand will last, and expects 2026 to be another growth year driven by EUV and the installed base [1].
- **A wide guidance range:** €34–39 billion for 2026 [1] implies growth of roughly 4% at the low end and 19% at the top (our calculation).

## Recommendations & next steps

1. **Track EUV units and revenue each quarter;** they drive both growth and margin mix [2][3].
2. **Model Installed Base Management separately** as the more recurring part of the business, linked to the size of the installed fleet [3].
3. **Watch High-NA (EXE) margin dilution** as volumes ramp [3].
4. **Monitor export controls and regional exposure;** the regional sales split was not in the sources reviewed and should be taken from the full annual report.
5. **Compare bookings with guidance** each quarter to judge which end of the 2026 range is in play.

## Sources & verification notes

- All 2024 and 2025 financial figures come from ASML's own publications: the full-year 2025 results release [1], the results presentation [2] and the financial-performance section of the 2025 Annual Report [3].
- Company background, machine prices and export-control history come from Wikipedia [4] (secondary; prices are reported figures, not ASML list prices).
- Our calculations: net system sales, per-system averages, net margins, R&D intensity and implied growth rates.
- Not covered: regional sales split, customer-concentration percentages and cash flow. Verify these in the full annual report. This explainer is not investment advice.
`,
  sources: [
    {
      n: 1,
      kind: "web",
      title: "ASML reports €32.7 billion total net sales and €9.6 billion net income in 2025",
      url: "https://investor.asml.com/news-releases/news-release-details/q4-2025-financial-results",
      domain: "investor.asml.com",
      snippet:
        "ASML's full-year 2025 results: total net sales €32,667m, Installed Base Management €8,193m, gross margin 52.8%, net income €9,609m, EPS €24.73, Q4 bookings €13.2bn (€7.4bn EUV), 2026 guidance of €34–39bn, €7.50 total dividend and a buyback of up to €12bn.",
      publishedAt: "2026-01-28",
    },
    {
      n: 2,
      kind: "web",
      title: "ASML 2025 fourth-quarter and full-year results",
      url: "https://ourbrand.asml.com/m/3136300aa4999bc1/original/2026_01_28_Presentation-Investor-Relations-Q4-2025.pdf",
      domain: "ourbrand.asml.com",
      snippet:
        "Investor presentation: in 2025 EUV system sales rose 39% to €11.6bn on 48 systems, DUV fell 6% to €12.0bn on 279 systems, Installed Base Management rose 26% to €8.2bn and Metrology & Inspection rose 28% to €825m.",
      publishedAt: "2026-01-28",
    },
    {
      n: 3,
      kind: "web",
      title: "ASML Annual Report 2025 – Financial performance",
      url: "https://ourbrand.asml.com/m/419103cb23dfeaa4/original/asml-2025-annual-report-financial-performance-section.pdf",
      domain: "ourbrand.asml.com",
      snippet:
        "Annual-report section: Logic €16.1bn and Memory €8.4bn of 2025 system sales, R&D costs of €4,698.8m, drivers of service and field-option growth, gross-margin drivers (NXE mix, EXE dilution) and stronger-than-expected China DUV business.",
      publishedAt: null,
    },
    {
      n: 4,
      kind: "wikipedia",
      title: "ASML Holding",
      url: "https://en.wikipedia.org/wiki/ASML_Holding",
      domain: "en.wikipedia.org",
      snippet:
        "Background: Veldhoven-based ASML was founded in 1984 by Philips and ASM International, holds a near-monopoly in EUV lithography, lists TSMC, Samsung and Intel among customers, trades on Euronext Amsterdam and Nasdaq, and has faced Dutch export restrictions since 2023.",
      publishedAt: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Go-to-market / content strategy — B2B launch (German e-invoicing)
// ---------------------------------------------------------------------------

const DE_EINVOICING_GTM: GalleryExample = {
  slug: "launch-content-strategy-german-e-invoicing",
  title: "Launch Content Strategy: E-Invoicing Software for German SMEs",
  category: "Marketing",
  summary:
    "A go-to-market content plan for a B2B e-invoicing product in Germany, built around the official 2027–2028 e-invoicing deadlines, the B2B buying journey and Google's current guidance on search and AI answers.",
  agentName: "Content Strategist",
  depth: "standard",
  position: 4,
  content: `# Launch Content Strategy: E-Invoicing Software for German SMEs

**Brief (assumed):** a cloud product that creates, sends and receives compliant e-invoices, launching in Germany in Q4 2026 to small and mid-sized businesses and their tax advisers.

## Executive summary

- **The market runs on a legal clock.** Domestic businesses have had to be able to receive e-invoices since 1 January 2025; the option to issue other invoice formats ends after 2026, or after 2027 for issuers with prior-year turnover up to €800,000 [1]; from 2028 the requirements apply to all domestic B2B transactions [2].
- **The audience is broad.** Germany has about 3.2 million enterprises in the sectors Destatis covers, 99.3% of them SMEs [3].
- **Buyers prefer to research alone.** Gartner reports that 75% of B2B buyers prefer a rep-free sales experience, yet self-service purchases are far more likely to end in regret [4]: content has to do the selling and de-risk the decision.
- **Search rewards trustworthy, people-first content,** and Google says no special optimisation is needed to appear in AI Overviews or AI Mode [5][6].
- **The strategy in one line:** own the question "what do I have to do, and by when?" for each turnover band, then convert with hands-on tools and human help.

## Audience and positioning

| Persona | Core question | What earns trust |
|---|---|---|
| Owner or managing director of a small firm | "Does this affect me, and what is the minimum I must do?" | Clear deadlines by turnover band; effort and cost estimates |
| Bookkeeper or finance lead | "Which format, which software, how do we receive and archive?" | Format explainers (XRechnung, ZUGFeRD) and step-by-step guides |
| Tax adviser (Steuerberater) | "Can I recommend this to many clients?" | Accuracy, citations of official guidance, partner terms |

**Positioning statement:** "E-invoicing done properly: compliant formats, a receiving inbox included, no PDF workarounds." The "no PDF" angle rests on official guidance that a simple PDF does not count as an e-invoice because it has no structured format [1].

## Content pillars mapped to the buying journey

Gartner describes six "buying jobs" that buyers work through: problem identification, solution exploration, requirements building, supplier selection, validation and consensus creation [4]. We map one pillar to each.

| Buying job [4] | Pillar | Flagship assets | Call to action |
|---|---|---|---|
| Problem identification | "Am I affected?" | Deadline checker by turnover band; plain-language FAQ citing the finance ministry [1] | Get your deadline |
| Solution exploration | "Ways to comply" | Guide comparing ERP modules, accounting add-ons, standalone tools and service providers | Download the guide |
| Requirements building | "What good looks like" | Checklist: formats (XRechnung and ZUGFeRD from version 2.0.1, excluding the MINIMUM and BASIC-WL profiles), receiving, archiving and the small-invoice exception up to €250 [1] | Use the checklist |
| Supplier selection | "Prove it" | Interactive demo, sample XRechnung file, free validator | Start a trial |
| Validation | "De-risk it" | Adviser-reviewed guides; security and data-location page | Book a 15-minute check |
| Consensus creation | "Sell it internally" | One-page business case and rollout plan for owner, finance lead and adviser | Share with your team |

Gartner also finds buyers are 1.8 times more likely to complete a high-quality deal when they use supplier-provided digital tools together with a sales rep rather than alone [4]. Every interactive tool should therefore offer a human follow-up rather than replace it.

## Search and AI-answer strategy

- **Write for people first.** Google's guidance favours content created to help people and names trust as the most important element of E-E-A-T [5]. Use named, qualified authors and visible review by a tax adviser.
- **Be explicit about who, how and why.** Google asks publishers to make authorship clear and to be transparent about how content was produced, including any use of automation or AI [5]. Disclose AI assistance and never mass-produce thin pages.
- **No special AI tricks.** To appear in AI Overviews or AI Mode a page only needs to be indexed and eligible for a snippet; Google recommends fundamentals such as crawlability, internal links, important content in text form and structured data that matches the visible text [6].
- **Keyword clusters to validate with search data:** "E-Rechnung Pflicht 2027", "XRechnung erstellen", "ZUGFeRD oder XRechnung", "E-Rechnung empfangen", "Kleinbetragsrechnung E-Rechnung".

## Launch calendar

| Window | Focus | Why |
|---|---|---|
| Oct–Dec 2026 | Firms above €800,000 turnover; adviser partnerships | Their option to issue non-e-invoices ends on 31 Dec 2026 [1] |
| Jan–Jun 2027 | Onboarding content, migration stories, "first 90 days" guides | New obligations are live and switching intent is high |
| Jul–Dec 2027 | Smaller firms (prior-year turnover up to €800,000) | Their transition period ends after 2027 [1] |
| 2028 | Retention and upsell (automation, payables workflows) | Requirements apply to all domestic B2B transactions [2] |

## KPIs

- Deadline-checker completions and checklist downloads (early buying jobs)
- Trial starts, and the share of trials with a human follow-up
- Adviser partner sign-ups and client referrals
- Organic visibility for the clusters above, including mentions in AI answers (tracked manually)

## Recommendations & next steps

1. **Ship the deadline checker and FAQ hub first;** they serve the widest audience and the earliest buying job.
2. **Recruit three to five tax advisers** as reviewers and launch partners before December 2026.
3. **Write natively in German;** avoid machine-translated explanations of legal requirements.
4. **Validate keyword volumes and competitor content** before locking the calendar.
5. **Add a clear disclaimer:** the content explains official guidance but is not tax advice.

## Sources & verification notes

- **Regulatory facts** come from the Federal Ministry of Finance FAQ (status March 2026) [1] and a chamber of commerce (IHK) guide [2]. Re-check both before publishing; guidance is updated periodically.
- **Market size** comes from Destatis (reference year 2024) [3].
- **Buyer-behaviour figures** are from Gartner's public summary [4], which does not state survey dates; treat them as directional.
- **Search guidance** is from Google Search Central documentation [5][6].
- **Not verified here:** keyword volumes, competitors' positioning and channel costs, which need a dedicated SEO and competitive audit.
`,
  sources: [
    {
      n: 1,
      kind: "web",
      title:
        "Fragen und Antworten zur Einführung der obligatorischen (verpflichtenden) E-Rechnung zum 1. Januar 2025",
      url: "https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html",
      domain: "www.bundesfinanzministerium.de",
      snippet:
        "German Federal Ministry of Finance FAQ: domestic businesses must be able to receive e-invoices since 1 January 2025; issuers may send other invoices until end-2026 (end-2027 if prior-year turnover is up to €800,000); XRechnung and ZUGFeRD 2.0.1+ qualify; a simple PDF does not; invoices up to €250 are excepted.",
      publishedAt: "2026-03",
    },
    {
      n: 2,
      kind: "web",
      title: "Elektronische Rechnungsabwicklung - Passende Lösungen finden",
      url: "https://www.ihk.de/freiburg/unternehmen-beraten/recht-steuern/steuerrecht/e-rechnung/e-rechnungsabwicklung-einstieg-6784622",
      domain: "www.ihk.de",
      snippet:
        "IHK Freiburg guide: all companies must be set up to receive e-invoices; from 2028 the new e-invoice requirements apply to all domestic companies' B2B transactions; formats follow the European standard EN 16931.",
      publishedAt: null,
    },
    {
      n: 3,
      kind: "web",
      title: "Small and medium-sized enterprises",
      url: "https://www.destatis.de/EN/Themes/Economic-Sectors-Enterprises/Enterprises/Small-Sized-Enterprises-Medium-Sized-Enterprises/_node.html",
      domain: "www.destatis.de",
      snippet:
        "Federal Statistical Office: in 2024, 99.3% of the 3.2 million enterprises in the sectors examined were SMEs (under 250 persons, turnover up to €50 million), employing 54% of persons employed.",
      publishedAt: null,
    },
    {
      n: 4,
      kind: "web",
      title: "The B2B Buying Journey: Key Stages and How to Optimize Them",
      url: "https://www.gartner.com/en/sales/insights/b2b-buying-journey",
      domain: "www.gartner.com",
      snippet:
        "Gartner's overview of the six B2B buying jobs; states that 75% of B2B buyers prefer a rep-free experience, that self-service purchases are more likely to cause regret, and that buyers using supplier digital tools with a rep are 1.8x more likely to complete a high-quality deal.",
      publishedAt: null,
    },
    {
      n: 5,
      kind: "web",
      title: "Creating Helpful, Reliable, People-First Content",
      url: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
      domain: "developers.google.com",
      snippet:
        "Google Search Central guidance on people-first content: E-E-A-T with trust as the most important element, the 'Who, How and Why' self-assessment, and transparency about the use of automation or AI.",
      publishedAt: "2026-10-01",
    },
    {
      n: 6,
      kind: "web",
      title: "AI Features and Your Website",
      url: "https://developers.google.com/search/docs/appearance/ai-features",
      domain: "developers.google.com",
      snippet:
        "Google states there are no additional requirements or special optimisations to appear in AI Overviews or AI Mode; pages must be indexed and snippet-eligible, and standard SEO best practices apply.",
      publishedAt: "2025-12-10",
    },
  ],
};

// ---------------------------------------------------------------------------
// 5. Operations brief — GDPR-compliant customer onboarding
// ---------------------------------------------------------------------------

const GDPR_ONBOARDING: GalleryExample = {
  slug: "gdpr-customer-onboarding-checklist-eu-saas",
  title: "GDPR-Ready Customer Onboarding: Operations Checklist for an EU SaaS",
  category: "Operations",
  summary:
    "A stage-by-stage onboarding checklist for a B2B SaaS that processes customers' personal data, covering roles, contracts, sub-processors, international transfers, breach readiness and what to automate, based on official EU guidance.",
  agentName: "Operations Automation Agent",
  depth: "standard",
  position: 5,
  content: `# GDPR-Ready Customer Onboarding: Operations Checklist for an EU SaaS

**Scope:** onboarding business customers onto a SaaS platform that stores and processes their end users' personal data. Written for operations, customer-success and engineering leads. This is operational guidance, not legal advice; have counsel approve your templates.

## Executive summary

- **Get the roles right first.** For data inside your product, the customer normally decides why and how it is processed (controller) and you process it on the customer's behalf (processor) [1]. The processor's duties must be set out in a contract or other legal act [1].
- **Company size is no exemption.** Whether the GDPR applies depends on the nature of your activities, not your size [5]; fines can reach €20 million or 4% of worldwide annual turnover, whichever is greater [11].
- **Use the standard templates.** The Commission adopted standard contractual clauses for controller–processor contracts on 4 June 2021 [6], alongside separate clauses for transfers outside the EU/EEA [7].
- **Breach clocks are short.** Processors must notify the controller of every data breach, and controllers have at most 72 hours to notify the supervisory authority [4], so onboarding must capture breach contacts on day one.
- **Automate the evidence.** Most steps below can be enforced by the onboarding workflow itself (gates, required fields, generated records), which is cheaper than retrospective audits.

## Step 1: map roles and legal bases

| Data in scope | Your typical role | Who chooses the legal basis |
|---|---|---|
| Customer's end-user data processed in the product | Processor | The customer, as controller [1][2] |
| Customer's admin and billing contacts | Controller | You; often the contract with the client [2] |
| Product analytics about admin users | Controller | You; legitimate interests or consent, after assessment [2] |

The GDPR provides six grounds for processing: consent, a contract with the individual, a legal obligation, a task in the public interest, vital interests, and legitimate interests (the last only after checking that the person's rights and freedoms are not seriously impacted) [2]. Record which ground you rely on for each activity where you are the controller.

## Step 2: the onboarding checklist

| Stage | Action | Owner | Evidence to keep |
|---|---|---|---|
| Pre-contract | Publish a privacy notice covering who you are (and DPO contact, if any), purposes, legal basis, retention, recipients, transfers outside the EU, individual rights and the right to complain to a data protection authority, in clear and plain language [3] | Legal / Ops | Versioned notice URL |
| Contract | Sign a data processing agreement, ideally based on the Commission's Article 28 clauses [6]; specify what happens to the data when the contract ends [1] | Legal / Sales | Signed DPA with version ID |
| Contract | Disclose sub-processors and obtain the controller's prior written authorisation for sub-contracting [1] | Legal | Sub-processor register with change log |
| Contract | Identify any transfers outside the EU/EEA and the safeguard used [7][8] | Legal / Engineering | Transfer map per customer |
| Account setup | Capture the customer's security and privacy contacts, data-location choices and retention settings | Customer success | Mandatory fields in the CRM |
| Data import | Import only the fields the customer needs; apply role-based access | Engineering / CS | Import log and access list |
| Go-live | Confirm privacy-protective defaults and security settings, in line with data protection by design [11] | Engineering | Signed configuration checklist |
| Ongoing | Keep a record of processing activities; the exemption for organisations under 250 employees does not apply where processing is a regular activity [5], as it is for a SaaS platform | Ops | Record of processing |
| Ongoing | Breach runbook: notify affected customers (controllers) of every breach [4] | Security | Incident log and drill reports |
| Offboarding | Return or delete data as the contract specifies [1] and confirm in writing | CS / Engineering | Deletion certificate |

## Step 3: international transfers

| Destination of data | Mechanism | Notes |
|---|---|---|
| Within the EU/EEA | Not a third-country transfer [7] | Article 28 contract terms still apply [6] |
| US recipient participating in the Data Privacy Framework | Adequacy decision adopted on 10 July 2023 [9] | Data can flow freely to participating US companies [8]; check each recipient's participation |
| Other countries without an adequacy decision | Standard contractual clauses for transfers [7] | Keep the transfer map current per customer |

The Data Privacy Framework has survived its first court test: on 3 September 2025 the EU General Court dismissed an action seeking its annulment, though an appeal to the Court of Justice remained possible [10]. Keep standard contractual clauses ready as a fallback for US sub-processors.

## Step 4: breach readiness from day one

- Controllers must notify the supervisory authority without undue delay and at the latest within 72 hours of becoming aware of a breach; affected individuals must also be informed when the breach poses a high risk to them, unless effective protective measures were in place [4].
- As a processor you must notify the controller of every breach [4]. Agree a contractual notice window (for example 24–48 hours) that leaves customers time to meet their own 72-hour deadline; the window is a commercial choice, not a legal figure.

## What to automate

| Manual task | Automation |
|---|---|
| Chasing DPA signatures | Click-through DPA in sign-up, with the accepted version stored on the account |
| Sub-processor change notices | Subscription list plus automatic email whenever the register changes |
| Record of processing | Generate entries from account configuration (purposes, data categories, retention) |
| Offboarding | Deletion job triggered by the contract end date, with an automatically issued certificate |
| Breach contacts | Mandatory at account creation, re-confirmed by a quarterly email |

## Recommendations & next steps

1. **Standardise on one DPA template** based on the Commission's Article 28 clauses [6] and stop negotiating bespoke versions with small customers.
2. **Make the workflow the control:** no data import until the DPA is accepted and breach contacts are captured.
3. **Publish a sub-processor page** with a change-notification sign-up.
4. **Rehearse breaches twice a year** against the 72-hour clock [4].
5. **Review US transfers** while litigation over the Data Privacy Framework can still continue [10].
6. **Ask counsel to review** role mapping, legal bases, the DPA template and transfer mechanisms.

## Sources & verification notes

- **Legal requirements** are summarised from the European Commission's official guidance pages [1][2][3][4][5][6][7][8]; background on the Data Privacy Framework and the GDPR is from Wikipedia [9][11]; the 2025 court ruling is from a privacy consultancy's analysis [10].
- **Operational judgment, not legal requirements:** notice windows, automation choices and the DPA strategy.
- **Not covered:** national rules (for example on employee data or specific sectors) and the latest EDPB guidelines; verify these with counsel.
- **Check at time of use:** the status of the Data Privacy Framework and any amendments to the GDPR.
`,
  sources: [
    {
      n: 1,
      kind: "web",
      title: "What is a data controller or a data processor?",
      url: "https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/controllerprocessor/what-data-controller-or-data-processor_en",
      domain: "commission.europa.eu",
      snippet:
        "European Commission guidance: the controller determines the purposes and means of processing, the processor acts on its behalf; the processor's duties must be in a contract or legal act, including what happens to data at termination; sub-processing needs prior written authorisation.",
      publishedAt: null,
    },
    {
      n: 2,
      kind: "web",
      title: "When can personal data be processed?",
      url: "https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/legal-grounds-processing-data/grounds-processing/when-can-personal-data-be-processed_en",
      domain: "commission.europa.eu",
      snippet:
        "Lists the six legal grounds for processing personal data: consent, contract, legal obligation, public-interest task, vital interests, and legitimate interests subject to a check on individuals' rights.",
      publishedAt: null,
    },
    {
      n: 3,
      kind: "web",
      title: "What information must be given to individuals whose data is collected?",
      url: "https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/principles-gdpr/what-information-must-be-given-individuals-whose-data-collected_en",
      domain: "commission.europa.eu",
      snippet:
        "Lists what individuals must be told (identity and DPO contact, purposes, legal basis, retention, recipients, non-EU transfers, rights, right to complain) and that it must be concise, transparent and in clear, plain language.",
      publishedAt: null,
    },
    {
      n: 4,
      kind: "web",
      title: "What is a data breach and what do we have to do in case of a data breach?",
      url: "https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/what-data-breach-and-what-do-we-have-do-case-data-breach_en",
      domain: "commission.europa.eu",
      snippet:
        "Controllers must notify the supervisory authority within 72 hours of becoming aware of a breach and inform individuals if there is a high risk; processors must notify every breach to the controller.",
      publishedAt: null,
    },
    {
      n: 5,
      kind: "web",
      title: "Do the rules apply to SMEs?",
      url: "https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/application-regulation/do-rules-apply-smes_en",
      domain: "commission.europa.eu",
      snippet:
        "GDPR application depends on the nature of activities, not company size; firms under 250 employees need records of processing when processing is regular, risky or involves sensitive data; DPO rules for SMEs.",
      publishedAt: null,
    },
    {
      n: 6,
      kind: "web",
      title: "Standard contractual clauses for controllers and processors in the EU/EEA",
      url: "https://commission.europa.eu/publications/standard-contractual-clauses-controllers-and-processors-eueea_en",
      domain: "commission.europa.eu",
      snippet:
        "Commission publication of standard contractual clauses between controllers and processors under Article 28(7) GDPR and Article 29(7) of Regulation 2018/1725, dated 4 June 2021.",
      publishedAt: "2021-06-04",
    },
    {
      n: 7,
      kind: "web",
      title: "Standard Contractual Clauses (SCC)",
      url: "https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/standard-contractual-clauses-scc_en",
      domain: "commission.europa.eu",
      snippet:
        "Commission page on the modernised standard contractual clauses for transferring personal data from controllers or processors in the EU/EEA to recipients established outside the EU/EEA.",
      publishedAt: "2021-06-04",
    },
    {
      n: 8,
      kind: "web",
      title: "EU-US data transfers",
      url: "https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/eu-us-data-transfers_en",
      domain: "commission.europa.eu",
      snippet:
        "Commission page on the EU-US Data Privacy Framework adequacy decision: personal data can flow freely from the EU to US companies that participate in the framework.",
      publishedAt: null,
    },
    {
      n: 9,
      kind: "wikipedia",
      title: "EU–US Data Privacy Framework",
      url: "https://en.wikipedia.org/wiki/EU%E2%80%93US_Data_Privacy_Framework",
      domain: "en.wikipedia.org",
      snippet:
        "Background article: the European Commission adopted its adequacy decision for the EU-US Data Privacy Framework on 10 July 2023; the framework has faced legal challenges.",
      publishedAt: null,
    },
    {
      n: 10,
      kind: "web",
      title: "Latombe v. European Commission: the DPF, ça tombe?",
      url: "https://www.privacycompany.eu/blog/latombe-v-european-commission-the-dpf-ca-tombe",
      domain: "www.privacycompany.eu",
      snippet:
        "Privacy Company analysis of the EU General Court's 3 September 2025 judgment dismissing the action to annul the Data Privacy Framework, noting that an appeal to the Court of Justice is possible.",
      publishedAt: "2025-09-03",
    },
    {
      n: 11,
      kind: "wikipedia",
      title: "General Data Protection Regulation",
      url: "https://en.wikipedia.org/wiki/General_Data_Protection_Regulation",
      domain: "en.wikipedia.org",
      snippet:
        "Background on the GDPR: applicable since 25 May 2018; fines up to €20 million or 4% of worldwide annual turnover, whichever is greater; Article 25 requires data protection by design.",
      publishedAt: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// 6. Technology / regulatory explainer — EU AI Act for a small software firm
// ---------------------------------------------------------------------------

const AI_ACT: GalleryExample = {
  slug: "eu-ai-act-small-software-company",
  title: "The EU AI Act for a Small Software Company: What Applies in Late 2026",
  category: "Legal",
  summary:
    "A plain-language explainer (not legal advice) of what the EU AI Act requires of a small SaaS company after the 2026 AI Omnibus: roles, risk tiers, transparency duties that apply now, the new high-risk dates and SME fine caps.",
  agentName: "Legal Research Assistant",
  depth: "deep",
  position: 6,
  content: `# The EU AI Act for a Small Software Company: What Applies in Late 2026

> This report explains the regulation in plain language. It is not legal advice; confirm how the rules apply to your products with qualified counsel.

**Client profile (assumed):** a 30-person EU software company selling a B2B SaaS product with built-in generative-AI features (a support chatbot and AI-drafted text) based on a third-party model, and considering an AI-assisted CV-screening module.

## Executive summary

- **Most of the Act now applies.** It entered into force on 1 August 2024; prohibitions and AI-literacy obligations applied from 2 February 2025, rules for general-purpose AI models from 2 August 2025, and since 2 August 2026 the AI Office and national authorities implement, supervise and enforce it [1].
- **High-risk deadlines have moved.** After the "AI Omnibus" entered into force on 27 July 2026, rules for high-risk systems in sensitive areas apply from 2 December 2027, and for AI built into regulated products from 2 August 2028 [1].
- **Most of the product is likely minimal or transparency risk.** The chatbot must tell users they are interacting with an AI system, and generated content must be marked in a machine-readable way [4].
- **The CV-screening module would be high-risk.** AI used to recruit, filter applications or evaluate candidates is listed in Annex III [5].
- **Fines are capped lower for SMEs:** for an SME, each cap is whichever is lower of the fixed amount and the turnover percentage [6].

## Provider or deployer? Your role decides your duties

| Role | Definition (summarised) [2] | Your situation |
|---|---|---|
| Provider | Develops an AI system, or has one developed, and places it on the market or puts it into service under its own name or trademark | Likely you, for AI features sold inside your product under your brand |
| Deployer | Uses an AI system under its own authority, other than for personal non-professional activity | Your customers; also you, for AI tools used internally |

An "AI system" is a machine-based system that, with varying autonomy, infers from its inputs how to generate outputs such as predictions, content, recommendations or decisions [2]. Building a feature on a third-party model and selling it under your brand appears to fit the provider definition on its face [2]; confirm the classification with counsel.

## Which risk tier applies?

| Tier [1] | Examples | Core obligations | Applies from |
|---|---|---|---|
| Unacceptable (banned) | Social scoring, harmful manipulation, emotion recognition in workplaces and education [1] | Do not build or use | 2 Feb 2025 [1] |
| High risk | Recruitment and candidate evaluation, creditworthiness scoring, critical infrastructure, education [5] | Risk assessment and mitigation, high-quality data, logging, documentation, information for deployers, human oversight, robustness and accuracy [1] | 2 Dec 2027 for Annex III areas; 2 Aug 2028 for regulated products [1] |
| Transparency | Chatbots, AI-generated or manipulated content, deepfakes [4] | Inform users, mark outputs, label deepfakes [4] | 2 Aug 2026 [7] |
| Minimal | Spam filters, AI-enabled video games [1] | No specific rules for this tier [1]; AI-literacy measures still apply [3] | n/a |

The Commission notes that the vast majority of AI systems used in the EU fall into the minimal-risk category [1], and that certain simplified requirements for SMEs, including simplified technical documentation, now extend to small mid-cap companies [1].

## What applies to you now (October 2026)

1. **AI literacy (Article 4).** As amended, providers and deployers must take measures to support the development of AI literacy among staff and others operating AI systems on their behalf, taking account of their knowledge and the context of use [3]. A law-firm summary of the Omnibus deal describes this as a shift from guaranteeing a level of literacy to supporting its development [7].
2. **Chatbot disclosure (Article 50(1)).** Design the support chatbot so users are informed that they are interacting with an AI system, unless that is obvious from the context [4].
3. **Marking generated content (Article 50(2)).** Providers of systems that generate synthetic audio, image, video or text must ensure outputs are marked in a machine-readable format and detectable as AI-generated; assistive editing functions are excepted [4]. Under the political agreement, systems already on the market before 2 August 2026 received a grace period for this marking duty until 2 December 2026 [7]; confirm this against the final text.
4. **Deepfakes and public-interest text (Article 50(4)).** Deployers must disclose deepfakes, and must disclose AI-generated text published to inform the public on matters of public interest unless it has undergone human review or editorial control [4].
5. **Prohibited practices.** Screen the roadmap against the banned list [1]; the Commission's list now includes AI systems that generate non-consensual sexually explicit or intimate content [1][7].

## Penalties

| Breach | Maximum fine [6] |
|---|---|
| Prohibited practices | €35 million or 7% of worldwide annual turnover, whichever is higher |
| Most other obligations | €15 million or 3%, whichever is higher |
| Incorrect or misleading information supplied to authorities | €7.5 million or 1%, whichever is higher |

For SMEs, including start-ups, each fine is capped at whichever of the two amounts is lower [6].

## A practical compliance plan

| When | Action |
|---|---|
| Now | Inventory every AI feature and internal AI tool; record your role and risk tier for each |
| Now | Ship chatbot disclosure and machine-readable marking of generated content [4] |
| Now | Run role-specific AI-literacy training and keep records [3] |
| Before building CV screening | Decide whether to enter a high-risk area at all; if yes, budget for compliance work well before 2 December 2027 [1][5] |
| Ongoing | Use the Commission's AI Act Service Desk for guidance [1] and track new guidelines and standards |

## Recommendations & next steps

1. **Treat transparency as a product feature:** disclosure UI and output marking belong in the roadmap, not in a policy document.
2. **Make an explicit go/no-go decision on CV screening;** high-risk status changes cost, documentation and timelines.
3. **Ask your model vendor** for contractual support on output marking and the technical information you need as a provider.
4. **Name an owner for AI compliance** and review quarterly while guidance and standards evolve.
5. **Obtain legal review** of your role classification and Article 50 implementation.

## Sources & verification notes

- **Timelines, risk tiers and Omnibus status** come from the European Commission's AI Act page, last updated 3 August 2026 [1]. **Legal text** comes from the Commission's AI Act Service Desk [2][3][4][5][6]. Some Service Desk pages carry notices that they have not yet been updated for the Omnibus, so check the consolidated text on EUR-Lex.
- **Details of the Omnibus political agreement** (literacy wording, the marking grace period, the 2 August 2026 transparency date) come from a law-firm summary written before formal adoption [7]; verify them against the final regulation.
- **Not legal advice:** classification depends on facts about your product and its use that require professional review.
`,
  sources: [
    {
      n: 1,
      kind: "web",
      title: "AI Act | Shaping Europe's digital future",
      url: "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai",
      domain: "digital-strategy.ec.europa.eu",
      snippet:
        "European Commission overview of the AI Act: four risk levels with examples, high-risk obligations, prohibited practices, the application timeline, the AI Omnibus (in force 27 July 2026) moving high-risk dates to 2 December 2027 and 2 August 2028, and SME support.",
      publishedAt: "2026-08-03",
    },
    {
      n: 2,
      kind: "web",
      title: "Article 3: Definitions | AI Act Service Desk",
      url: "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-3",
      domain: "ai-act-service-desk.ec.europa.eu",
      snippet:
        "Text of Article 3 of the AI Act, including the definitions of 'AI system', 'provider' and 'deployer'.",
      publishedAt: null,
    },
    {
      n: 3,
      kind: "web",
      title: "Article 4: AI literacy | AI Act Service Desk",
      url: "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-4",
      domain: "ai-act-service-desk.ec.europa.eu",
      snippet:
        "Article 4 as amended by the Digital Omnibus on AI: providers and deployers shall take measures to support the development of AI literacy of their staff and others operating AI systems on their behalf.",
      publishedAt: null,
    },
    {
      n: 4,
      kind: "web",
      title:
        "Article 50: Transparency obligations for providers and deployers of certain AI systems | AI Act Service Desk",
      url: "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50",
      domain: "ai-act-service-desk.ec.europa.eu",
      snippet:
        "Article 50: users must be informed they are interacting with an AI system; synthetic audio, image, video and text must be marked in a machine-readable format; deepfakes and certain AI-generated public-interest text must be disclosed.",
      publishedAt: null,
    },
    {
      n: 5,
      kind: "web",
      title: "ANNEX III | AI Act Service Desk",
      url: "https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3",
      domain: "ai-act-service-desk.ec.europa.eu",
      snippet:
        "Annex III lists the eight high-risk areas, including employment (recruitment, filtering applications, evaluating candidates) and creditworthiness assessment of natural persons.",
      publishedAt: null,
    },
    {
      n: 6,
      kind: "web",
      title: "Article 99: Penalties | AI Act Service Desk",
      url: "https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-99",
      domain: "ai-act-service-desk.ec.europa.eu",
      snippet:
        "Article 99 sets maximum fines of €35m/7%, €15m/3% and €7.5m/1% (whichever is higher), and for SMEs including start-ups whichever is lower.",
      publishedAt: null,
    },
    {
      n: 7,
      kind: "web",
      title: "EU AI Act Omnibus Agreement — Postponed High-Risk Deadlines and Other Key Changes",
      url: "https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines/",
      domain: "www.gibsondunn.com",
      snippet:
        "Gibson Dunn on the May 2026 political agreement: high-risk dates of 2 December 2027 and 2 August 2028, Article 50 transparency proceeding from 2 August 2026 with a marking grace period to 2 December 2026, revised AI-literacy wording and a new prohibition on non-consensual intimate imagery.",
      publishedAt: "2026-05-27",
    },
  ],
};

export const GALLERY_EXAMPLES: GalleryExample[] = [
  EV_CHARGING,
  SPAIN_ENTRY,
  ASML,
  DE_EINVOICING_GTM,
  GDPR_ONBOARDING,
  AI_ACT,
];
