"""Bikram Sambat (BS) dates on the server (receipts, emails), matching the website (nepali-date-converter) and the app.

The month lengths are the website library's table (generated from it); BS 2070 Baisakh 1 = 14 April 2013.
Outside the table (before 2013 or after BS 2090) dates fall back to AD.
"""
import datetime

MONTHS = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra']
START_AD = datetime.date(2013, 4, 14)
START_BS = 2070
DAYS = {
    2070: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
    2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2072: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2073: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2074: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
    2075: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
    2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
    2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
    2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2084: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2085: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2086: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
    2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
    2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
    2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
}


def to_bs(day):
    """(year, month 1-12, day) in BS for an AD date, or None outside the table."""
    if isinstance(day, datetime.datetime):
        day = day.date()
    left = (day - START_AD).days
    if left < 0:
        return None
    year = START_BS
    while year in DAYS:
        for month, length in enumerate(DAYS[year], start=1):
            if left < length:
                return year, month, left + 1
            left -= length
        year += 1
    return None


def bs_text(day, weekday=False):
    """"10 Kartik 2083" (or "Tue, 10 Kartik 2083"); AD text outside the table."""
    if day is None:
        return ''
    if isinstance(day, datetime.datetime):
        day = day.date()
    bs = to_bs(day)
    prefix = f'{day:%a}, ' if weekday else ''
    if bs is None:
        return prefix + f'{day:%d %b %Y}'.lstrip('0')
    return f'{prefix}{bs[2]} {MONTHS[bs[1] - 1]} {bs[0]}'
