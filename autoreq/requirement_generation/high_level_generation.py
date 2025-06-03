import json
import logging
from pydantic import BaseModel
from typing import List

from ..llm_client import LLMClient
from ..test_generation.environment import Environment
from ..requirements_manager import RequirementsManager


class AtomicRequirement(BaseModel):
    req_id: str
    module_name: str
    text: str


class AbstractRequirement(BaseModel):
    from_requirements: List[AtomicRequirement]
    text: str
    module_name: str


class Requirements(BaseModel):
    requirements: List[AbstractRequirement]


class HighLevelRequirementsGenerator:
    def __init__(
        self,
        environment: Environment,
        low_level_requirements: RequirementsManager,
        extended_reasoning: bool = False,
    ):
        self.llm_client = LLMClient()
        self.environment = environment
        self.low_level_requirements = low_level_requirements
        self.extended_reasoning = extended_reasoning

    async def generate(
        self, unit_name: str, return_raw: bool = False
    ) -> List[AbstractRequirement]:
        """Generate high-level requirements for a given unit/module."""

        module_input_data = {}
        all_low_level_reqs_list = self.low_level_requirements.requirements_to_dict()

        unit_specific_reqs = {}
        req_count = 0
        for req_data in all_low_level_reqs_list:
            if (
                req_data.get('Module') == unit_name
                and req_data.get('ID')
                and req_data.get('Description')
            ):
                if req_data.get('Function') != 'None':
                    unit_specific_reqs[req_data['ID']] = req_data['Description']
                    req_count += 1

        if not unit_specific_reqs:
            return []

        module_input_data[unit_name] = {
            'count': req_count,
            'requirements': unit_specific_reqs,
        }

        system_prompt_content = """
You are a senior software–requirements engineer and editor.
Your sole task is to transform many fine-grained “Atomic” requirements into a shorter set of higher-level “Abstract” requirements.

**INPUT FORMAT**

- The user supplies ONE JSON object whose **top-level keys are module names**.
  {
    "<module_name>": {
      "count": <int>,                     # number of atomic reqs in this module
      "requirements": {                   # dict[req-id -> text]
        "<REQ-ID-1>": "<text>",
        "<REQ-ID-2>": "<text>",
        ...
      }
    },
    ...
  }

**OUTPUT FORMAT**

1. Preserve the original intent. Never add new behaviour.
2. Remove redundant wording and merge overlapping requirements.
3. Return exactly ONE JSON object that is directly loadable by these Pydantic models—no Markdown, no comments, no extra keys:
```python
class AtomicRequirement(BaseModel):
    req_id: str
    module_name: str
    text: str

class AbstractRequirement(BaseModel):
    from_requirements: list[AtomicRequirement]   # ≥1 items
    text: str
    module_name: str

class Requirements(BaseModel):
    requirements: list[AbstractRequirement]
```
4. Abstract very specific requirements into a more general and intuitive wording.
5. Make the high-level requirements more generally applicable and not too specific
6. In the high-level requirements you don't need to rephrase all the things that the LLRs do individually, but find a more general description that captures their intent.

**LINGUISTIC STYLE**

Study the style_examples first and imitate their:
- abstraction level
- Verb choice (“shall …”),
- Passive/active voice,
- Prefer active voice when possible, but passive is acceptable if used in the examples.
- Use of notes (prefix with “NOTE: ” when needed).

**TRANSFORMATION RULES**

- Group atomic requirements by module_name.
    For each group:
        - Detect overlaps / common goals.
        - Merge them into higher-level requirements that cut the total count by roughly 70%, if possible.
        - For every new AbstractRequirement, list all atomic requirements ids that justify it inside from_requirements.
        - Keep the same module_name as the atoms you are grouping.
- If a single higher-level requirement logically spans multiple modules, duplicate it. Emit one AbstractRequirement per affected module, each pointing to the same text but with its own filtered from_requirements.
- If any atomic requirement is unclear, still include it in from_requirements but prefix its text with "unclear – ".
- Do not reorder wording inside an atomic requirement’s text. You may re-phrase only the new AbstractRequirement text.

**OUTPUT**

Return a single JSON object that matches the Requirements model exactly, no extra keys, no Markdown.

**VALIDATION CHECKLIST**

- Output must be valid JSON, parsable by the Pydantic models.
- Every AbstractRequirement must contain at least one AtomicRequirement in from_requirements.
- No Markdown, comments, or trailing commas.
- Follow the linguistic and the abstraction style of the examples.
- If you cannot satisfy the model, output the closest valid JSON and add key "validation_failed": true"

**TRANSFORMATION EXAMPLES**:

LLR1: The function shall configure the queue by assigning the provided element count and element length to the appropriate fields, and by setting the read index to zero and the write index to the element count during initialization.
LLR1: The function shall initialize each element in the queue so that its length is set to zero and its data pointer is assigned to the corresponding position within the supplied buffer.
LLR1: The function shall guarantee that upon completion of initialization, both the queue structure and all its elements are fully prepared for use in subsequent queue operations.

HLR: The system shall provide a function that fully initializes the queue, by setting the element count, read index and write index, then zero-initializes each element and links its data pointers to the buffer, leaving the queue ready for use.
---
LLR1: When an unauthenticated HTTP GET request is made to /, the system shall return HTTP 200 with the public home page.
LLR2: When an unauthenticated HTTP POST request is made to any public endpoint, the system shall return HTTP 401 or 403.

HLR:The system shall publicly serve the home page to any visitor while preventing unauthenticated users from performing state-changing (POST) operations on public endpoints.
---
LLR1: The /login endpoint shall serve an HTML form containing fields email and password.
LLR2: When valid credentials are posted to /login, the system shall create a server-side session and respond with HTTP 302 redirect to /dashboard.
LLR3: When invalid credentials are posted to /login, the system shall respond with HTTP 401 and shall not create a session.
LLR4: Session cookies shall have the Secure and HttpOnly flags set.

HLR: The system shall provide a login form, authenticate users with email and password, establish Secure + HttpOnly session cookies on success, redirect authenticated users to their dashboard, and refuse access—with no session creation—when credentials are invalid.
---
LLR1: Passwords shall be rejected at registration if shorter than 12 characters.
LLR2: Passwords shall be rejected if missing at least one uppercase letter.
LLR3: Passwords shall be rejected if missing at least one lowercase letter.
LLR4: Passwords shall be rejected if missing at least one numeral.
LLR5: Passwords shall be rejected if missing at least one special character from the set `!@#$%^&*()_+-=[]{}	;':",.<>/?`.
LLR6: The endpoint /password/forgot shall accept email via HTTP POST and, if the account exists, issue a reset token.
LLR7: Password-reset tokens shall expire 24 h after creation.
LLR8: The /password/reset endpoint shall require a valid, unexpired token before permitting a new password to be set.

HLR: The system shall enforce a strong password policy at registration (minimum length plus upper-case, lower-case, numeric, and special-character requirements) and supply a secure password-reset workflow that issues single-use tokens expiring after 24 hours and validates them before allowing a new password to be set.
---
LLR1: Authenticated users may retrieve their own profile via GET /profile returning HTTP 200 and JSON body.
LLR2: The system shall reject profile retrieval by a user whose session is invalid, returning HTTP 401.
LLR3: Authenticated users may update permitted profile fields via PATCH /profile with JSON payload; on success the system returns HTTP 200 and the updated object.
LLR4: Attempting to update fields not on the allow-list shall return HTTP 400.
LLR5: An authenticated user may not update another user’s profile. Such requests shall return HTTP 403.

HLR: The system shall let an authenticated user retrieve or update only the whitelisted fields of their own profile, returning the updated data on success, and shall block requests that are unauthenticated, target disallowed fields, or attempt to access another user’s profile.

**ABSTRACTED REQUIREMENT EXAMPLES**:

DADC module shall wakeup whenever hardwired ignition signal (KL15) is HIGH.
DADC module shall shutdown (low power mode) only when the ignition status signal (KL15) is LOW.
Power management software within MCU and ORIN_CCPLEX shall communicate with each other via SOMEIP communication mechanism as chapter "Communication between AURIX and ORIN CCPLEX".
Power management Software within CCPLEX shall offer the attached SOMEIP services to MCU Software with which "DADC Internal Life Cycle" shall be realized.
VLCA software component shall be hosted in SMCU and it shall communicate with CVLC via SOMEIP interface based on reference [23] and [24].
MCU software shall enter the FULL power mode & request ORIN to enter FULL power mode only when the KL15 is HIGH.
MCU DADC power management software components shall be scheduled at 10ms and the components which control the power to ORIN & IO hardware abstraction components shall be scheduled at 5ms.
DADC software within MCU shall program PMIC to monitor the supplies of MCU for failures based on reference [2].
DADC Voltage Monitoring software components shall be scheduled at 5ms.
SPI communication between ORIN & AURIX to exchange internal ORIN thermal fault information shall be E2E protected as per reference  [1],  [2] & [15]
LOKI software shall report any thermal errors & temperature values to the UART console.
DADC Thermal Monitoring software components shall be scheduled at 10ms.
Start up code in Aurix shall start the initialisation of Classic Autosar stack as soon as power is enabled to Aurix.
Core 0 on Aurix shall act as Master core and remaining cores are slaves.
"""

        user_prompt_content = (
            f"In the following, I provided you with the low level requirements for module '{unit_name}' "
            'that have to be abstracted into higher level requirements:\n'
            '```json\n'
            f'{json.dumps(module_input_data, indent=2)}\n'
            '```\n'
        )

        source_code_content = None
        source_code_content = self.environment.get_tu_content(
            unit_name=unit_name, reduction_level='high'
        )
        if source_code_content:
            user_prompt_content += (
                f"\nAnd here is the corresponding code file for module '{unit_name}':\n"
                '```c\n'
                f'{source_code_content}\n'
                '```\n'
            )
        else:
            logging.warning(
                f"Could not retrieve valid source code for unit {unit_name} for HLR generation. Content: '{source_code_content}'"
            )
            source_code_content = None

        messages = [
            {'role': 'system', 'content': system_prompt_content},
            {'role': 'user', 'content': user_prompt_content},
        ]

        response_model = await self.llm_client.call_model(
            messages=messages,
            schema=Requirements,
            temperature=0.6,
            max_tokens=4000,
            extended_reasoning=self.extended_reasoning,
        )

        if response_model and response_model.requirements:
            return [
                req if return_raw else req.text
                for req in response_model.requirements
                if req.module_name == unit_name
            ]

        return []
