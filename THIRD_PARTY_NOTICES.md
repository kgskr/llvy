# 외부 자료 및 권리 안내

[프로젝트 README](README.md) · [자체 코드 라이선스](LICENSE)

LLVY의 PolyForm Noncommercial 라이선스는 프로젝트 기여자가 권리를 보유한 자체 코드와
문서에만 적용됩니다. 아래 자료의 기존 라이선스·권리·이용 조건을 대체하거나 제한하지 않으며,
제3자의 자료에 대한 추가 권한을 부여하지 않습니다.

## Riot Games 자료

챔피언 이름·초상화와 아이템 이름·아이콘은 Riot Games의 Data Dragon에서 가져옵니다.
관련 구현은 `src/lib/champions.ts`와 `src/lib/game-assets.ts`에 있습니다.
League of Legends와 관련 캐릭터·이미지·상표 등 Riot Games의 지식재산은 자체 코드
라이선스의 적용 대상이 아닙니다.

- [Data Dragon 문서](https://developer.riotgames.com/docs/lol#data-dragon)
- [Legal Jibber Jabber](https://www.riotgames.com/en/legal)
- [개발자 일반 정책](https://developer.riotgames.com/policies/general)

Riot 자료를 이용하거나 이 코드를 바탕으로 서비스를 운영하는 사람은 적용되는 Riot 정책과
제품 등록·심사 등 필요한 절차를 별도로 확인해야 합니다. 이 저장소의 라이선스나 고지는
Riot의 승인·등록·사용 허락을 대신하지 않습니다.

LLVY isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or
anyone officially involved in producing or managing Riot Games properties. Riot Games, and all
associated properties are trademarks or registered trademarks of Riot Games, Inc.

## Discord 로고

`src/app/login/login-form.tsx`의 인라인 SVG는 Discord가 제공하는 공식 흰색 심볼입니다.
Discord의 상표와 브랜드 자료는 Discord Inc.의 자산이며 자체 코드 라이선스의 적용 대상이
아닙니다. 이 저장소는 로고에 대한 추가 이용 권한을 부여하지 않습니다.

- [공식 브랜드 자료와 이용 지침](https://discord.com/branding)
- [사용한 흰색 심볼 SVG](https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/66e3d7f4ef6498ac018f2c55_Symbol.svg)
- [로그인 버튼 디자인의 참고 가이드](https://docs.discord.com/developers/discord-social-sdk/design-guidelines/branding-guidelines)

## 모임원이 제공한 배너

`src/assets/lolive-young.jpeg`는 모임원이 AI로 생성하여 LLVY에서 사용하도록 제공한
이미지입니다. 이 이미지에 대한 제3자의 수정·재배포 허락은 확인되지 않았으므로 자체 코드
라이선스에서 제외합니다. 이 저장소는 이미지에 대한 별도의 이용 권한을 부여하지 않습니다.
다른 프로젝트나 배포본에서 사용하려면 제공자에게 필요한 허락의 범위를 확인하거나,
사용할 권리가 있는 이미지로 교체하세요. 이미지에 포함된 Riot 관련 요소에는 Riot의 권리가
별도로 적용됩니다.

## Unicode 데이터

`src/lib/search-unicode-data.json`의 Unicode 정규화 데이터와 이를 이용해 생성한
SQL 데이터에는 Unicode 데이터가 포함됩니다. 생성 로직은
`scripts/search-normalization.mjs`에 있습니다.

- [Unicode 17.0.0 UnicodeData.txt](https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt)
- [Unicode 17.0.0 DerivedAge.txt](https://www.unicode.org/Public/17.0.0/ucd/DerivedAge.txt)
- 저작권·허가 고지: [Unicode License V3](scripts/UNICODE-LICENSE.txt)

해당 데이터를 재배포할 때는 위 저작권·허가 고지를 함께 유지하세요.

## 리플레이 포맷 참고 자료

`src/lib/rofl/parser.ts`는 ROFL2 버전 필드의 위치를 확인하기 위해
[Toastaspiring/ROFL-X의 포맷 문서](https://github.com/Toastaspiring/ROFL-X/blob/main/docs/ROFL_FORMAT.md#section-a-fileheader)를
참조하고, 제공받은 리플레이 파일과 대조한 사실을 기록합니다.
이는 포맷 정보의 출처 표기이며, Riot이 보장하는 공식 파일 규격이라는 뜻은 아닙니다.

참고 프로젝트의 [라이선스와 출처 고지](https://github.com/Toastaspiring/ROFL-X/blob/main/LICENSE)는
그 프로젝트의 코드·문서에 적용됩니다. 해당 자료를 추가로 복사하거나 포함하는 경우에는
그 조건을 별도로 확인하고 필요한 고지를 유지해야 합니다.

## npm 의존성

`package.json`과 `package-lock.json`에 선언된 패키지는 각 패키지의 원래 라이선스를
따릅니다. 프로젝트 루트의 비상업 조건이 해당 패키지 자체의 이용 권한을 제한하지 않습니다.

| 직접 실행 의존성                                       | 라이선스   |
| ------------------------------------------------------ | ---------- |
| `next`, `react`, `react-dom`, `ioredis`, `server-only` | MIT        |
| `@vercel/blob`, `@vercel/postgres`, `drizzle-orm`      | Apache-2.0 |

이 표는 전체 의존성 목록이 아닙니다. 잠금 파일에는 개발·간접·플랫폼별 선택 의존성도 있으며,
예를 들어 libvips 관련 패키지에는 LGPL-3.0-or-later, Lightning CSS에는 MPL-2.0,
`caniuse-lite`에는 CC-BY-4.0이 표시되어 있습니다.

정확한 버전은 `package-lock.json`, 전체 조건과 저작권 고지는 배포에 포함되는 각 패키지의
`LICENSE`, `COPYING`, `NOTICE` 등 원문을 확인하세요. Next.js에 번들된 패키지를 비롯해
실제로 재배포하는 구성요소의 고지를 유지하고, 해당되는 소스 제공 등 배포 의무를 준수해야 합니다.
이 안내는 패키지별 원문 고지나 배포 형태에 따른 확인을 대체하지 않습니다.

## AI 생성과 라이선스 범위

프로젝트 관리자는 애플리케이션 코드를 AI로 생성했다고 설명했습니다. AI 사용 자체가
모든 산출물의 저작권 보유나 제3자 권리 부재를 보장한다는 뜻은 아닙니다.
자체 코드 라이선스는 기여자가 실제로 보유하고 허가할 수 있는 권리 범위에서만 적용되며,
법적으로 보호되지 않는 요소에 새로운 독점권을 주장하지 않습니다.
