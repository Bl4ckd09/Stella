"""London borough business rates contacts for SBRR claims.

Each entry: apply_url is the council's SBRR application page.
email is the business rates team contact where available.
"""

BOROUGH_CONTACTS: dict[str, dict] = {
    "barking and dagenham": {
        "apply_url": "https://www.lbbd.gov.uk/business-rates-relief",
        "email": "businessrates@lbbd.gov.uk",
        "phone": "020 8227 2000",
    },
    "barnet": {
        "apply_url": "https://www.barnet.gov.uk/business-rates/business-rates-reductions-and-reliefs/small-business-rate-relief",
        "email": "businessrates@barnet.gov.uk",
        "phone": "020 8359 4508",
    },
    "bexley": {
        "apply_url": "https://www.bexley.gov.uk/services/business-rates/business-rates-relief",
        "email": "businessrates@bexley.gov.uk",
        "phone": "020 8303 7777",
    },
    "brent": {
        "apply_url": "https://www.brent.gov.uk/services/business-and-licensing/business-rates/business-rate-reliefs-and-exemptions/",
        "email": "businessrates@brent.gov.uk",
        "phone": "020 8937 1500",
    },
    "bromley": {
        "apply_url": "https://www.bromley.gov.uk/business-rates/business-rates-relief-reductions",
        "email": "business.rates@bromley.gov.uk",
        "phone": "020 8464 3333",
    },
    "camden": {
        "apply_url": "https://www.camden.gov.uk/business-rates-relief#sbrr",
        "email": "businessrates@camden.gov.uk",
        "phone": "020 7974 6019",
    },
    "city of london": {
        "apply_url": "https://www.cityoflondon.gov.uk/business/business-rates/business-rates-relief",
        "email": "businessrates@cityoflondon.gov.uk",
        "phone": "020 7332 1610",
    },
    "croydon": {
        "apply_url": "https://www.croydon.gov.uk/business/rates/reliefs",
        "email": "businessrates@croydon.gov.uk",
        "phone": "020 8726 6000",
    },
    "ealing": {
        "apply_url": "https://www.ealing.gov.uk/info/201146/business_rates/1088/business_rates_relief",
        "email": "businessrates@ealing.gov.uk",
        "phone": "020 8825 5000",
    },
    "enfield": {
        "apply_url": "https://new.enfield.gov.uk/services/business/business-rates-relief/",
        "email": "businessrates@enfield.gov.uk",
        "phone": "020 8379 1000",
    },
    "greenwich": {
        "apply_url": "https://www.royalgreenwich.gov.uk/info/200214/business_rates/161/business_rates_reliefs",
        "email": "businessrates@royalgreenwich.gov.uk",
        "phone": "020 8854 8888",
    },
    "hackney": {
        "apply_url": "https://hackney.gov.uk/business-rates#relief",
        "email": "businessrates@hackney.gov.uk",
        "phone": "020 8356 3559",
    },
    "hammersmith and fulham": {
        "apply_url": "https://www.lbhf.gov.uk/business/business-rates/business-rates-relief-and-exemptions",
        "email": "businessrates@lbhf.gov.uk",
        "phone": "020 8748 3020",
    },
    "haringey": {
        "apply_url": "https://www.haringey.gov.uk/business/business-rates/reductions-and-exemptions",
        "email": "businessrates@haringey.gov.uk",
        "phone": "020 8489 1000",
    },
    "harrow": {
        "apply_url": "https://www.harrow.gov.uk/business-rates/business-rates-relief",
        "email": "businessrates@harrow.gov.uk",
        "phone": "020 8424 1130",
    },
    "havering": {
        "apply_url": "https://www.havering.gov.uk/info/20012/business_rates/179/business_rates_relief",
        "email": "businessrates@havering.gov.uk",
        "phone": "01708 434343",
    },
    "hillingdon": {
        "apply_url": "https://www.hillingdon.gov.uk/article/1965/Business-rates-relief",
        "email": "businessrates@hillingdon.gov.uk",
        "phone": "01895 250111",
    },
    "hounslow": {
        "apply_url": "https://www.hounslow.gov.uk/info/20041/business_rates/324/business_rates_relief",
        "email": "businessrates@hounslow.gov.uk",
        "phone": "020 8583 5555",
    },
    "islington": {
        "apply_url": "https://www.islington.gov.uk/business-rates/business-rates-relief",
        "email": "businessrates@islington.gov.uk",
        "phone": "020 7527 2633",
    },
    "kensington and chelsea": {
        "apply_url": "https://www.rbkc.gov.uk/council-tax-and-business-rates/business-rates/business-rates-relief-and-reductions",
        "email": "businessrates@rbkc.gov.uk",
        "phone": "020 7361 3005",
    },
    "kingston upon thames": {
        "apply_url": "https://www.kingston.gov.uk/business-rates/business-rates-relief/",
        "email": "businessrates@kingston.gov.uk",
        "phone": "020 8547 5008",
    },
    "lambeth": {
        "apply_url": "https://www.lambeth.gov.uk/business-rates/apply-for-business-rates-relief",
        "email": "businessrates@lambeth.gov.uk",
        "phone": "020 7926 1000",
    },
    "lewisham": {
        "apply_url": "https://lewisham.gov.uk/myservices/business-rates/reliefs-and-exemptions",
        "email": "businessrates@lewisham.gov.uk",
        "phone": "020 8314 9292",
    },
    "merton": {
        "apply_url": "https://www.merton.gov.uk/council-and-democracy/council-finances/business-rates/business-rates-relief",
        "email": "businessrates@merton.gov.uk",
        "phone": "020 8274 4901",
    },
    "newham": {
        "apply_url": "https://www.newham.gov.uk/business-rates/business-rates-relief-reductions",
        "email": "businessrates@newham.gov.uk",
        "phone": "020 8430 2000",
    },
    "redbridge": {
        "apply_url": "https://www.redbridge.gov.uk/business-rates/business-rates-relief/",
        "email": "businessrates@redbridge.gov.uk",
        "phone": "020 8554 5000",
    },
    "richmond upon thames": {
        "apply_url": "https://www.richmond.gov.uk/business_rates_relief",
        "email": "businessrates@richmond.gov.uk",
        "phone": "020 8891 1411",
    },
    "southwark": {
        "apply_url": "https://www.southwark.gov.uk/business/business-rates/business-rates-relief",
        "email": "businessrates@southwark.gov.uk",
        "phone": "020 7525 7525",
    },
    "sutton": {
        "apply_url": "https://www.sutton.gov.uk/info/200422/business_rates/1081/business_rates_relief_and_reductions",
        "email": "businessrates@sutton.gov.uk",
        "phone": "020 8770 5000",
    },
    "tower hamlets": {
        "apply_url": "https://www.towerhamlets.gov.uk/lgnl/business/business_rates/business_rates_relief.aspx",
        "email": "businessrates@towerhamlets.gov.uk",
        "phone": "020 7364 5000",
    },
    "waltham forest": {
        "apply_url": "https://www.walthamforest.gov.uk/business-rates/business-rates-relief",
        "email": "businessrates@walthamforest.gov.uk",
        "phone": "020 8496 3000",
    },
    "wandsworth": {
        "apply_url": "https://www.wandsworth.gov.uk/business-rates/business-rates-relief/",
        "email": "businessrates@wandsworth.gov.uk",
        "phone": "020 8871 6000",
    },
    "westminster": {
        "apply_url": "https://www.westminster.gov.uk/businesses/business-rates/business-rates-reliefs",
        "email": "businessrates@westminster.gov.uk",
        "phone": "020 7641 6565",
    },
}


# gov.uk official tool — works for any postcode, always up to date
GOVUK_COUNCIL_FINDER = "https://www.gov.uk/apply-for-business-rate-relief/small-business-rate-relief"


def get_contact(borough: str) -> dict:
    """Return contact info for a borough. Always includes gov.uk fallback URL."""
    key = borough.strip().lower()
    info = BOROUGH_CONTACTS.get(key, {})
    return {
        "council_url":  info.get("apply_url", ""),       # direct council page (may need browser)
        "govuk_url":    GOVUK_COUNCIL_FINDER,             # always works
        "email":        info.get("email", ""),
        "phone":        info.get("phone", ""),
        "borough_name": borough.title(),
    }
