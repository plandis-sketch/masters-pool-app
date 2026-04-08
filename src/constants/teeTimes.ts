/**
 * Round 1 tee times for the 2026 Masters Tournament — Thursday, April 9, 2026.
 * All times are ET. Groups are in tee-time order (earliest first).
 */

export interface TeeTimeGroup {
  time: string;
  names: string[];
}

export const ROUND1_TEE_TIMES: TeeTimeGroup[] = [
  { time: '7:40 AM', names: ['John Keefer', 'Haotong Li'] },
  { time: '7:50 AM', names: ['Naoyuki Kataoka', 'Max Homa', 'Carlos Ortiz'] },
  { time: '8:02 AM', names: ['Jose Maria Olazabal', 'Rasmus Neergaard-Petersen', 'Aldrich Potgieter'] },
  { time: '8:14 AM', names: ['Angel Cabrera', 'Sami Valimaki', 'Jackson Herrington'] },
  { time: '8:26 AM', names: ['Charl Schwartzel', 'Max Greyserman', 'Ryan Fox'] },
  { time: '8:38 AM', names: ['Vijay Singh', 'Matt McCarty', 'Rasmus Hojgaard'] },
  { time: '8:50 AM', names: ['Kurt Kitayama', 'Kristoffer Reitan', 'Casey Jarvis'] },
  { time: '9:02 AM', names: ['Bubba Watson', 'Nico Echavarria', 'Brandon Holtz'] },
  { time: '9:19 AM', names: ['Cameron Smith', 'Sam Burns', 'Jake Knapp'] },
  { time: '9:31 AM', names: ['Keegan Bradley', 'Ryan Gerard', 'Nick Taylor'] },
  { time: '9:43 AM', names: ['Dustin Johnson', 'Shane Lowry', 'Jason Day'] },
  { time: '9:55 AM', names: ['Patrick Reed', 'Tommy Fleetwood', 'Akshay Bhatia'] },
  { time: '10:07 AM', names: ['Bryson DeChambeau', 'Matt Fitzpatrick', 'Xander Schauffele'] },
  { time: '10:19 AM', names: ['Hideki Matsuyama', 'Collin Morikawa', 'Russell Henley'] },
  { time: '10:31 AM', names: ['Rory McIlroy', 'Cameron Young', 'Mason Howell'] },
  { time: '10:43 AM', names: ['Viktor Hovland', 'Patrick Cantlay', 'Alex Noren'] },
  { time: '11:03 AM', names: ['Sam Stevens', 'Sung-Jae Im'] },
  { time: '11:15 AM', names: ['Andrew Novak', 'Tom McKibbin', 'Brian Campbell'] },
  { time: '11:27 AM', names: ['Mike Weir', 'Wyndham Clark', 'Mateo Pulcini'] },
  { time: '11:39 AM', names: ['Zach Johnson', 'Michael Kim', 'Nicolai Hojgaard'] },
  { time: '11:51 AM', names: ['Danny Willett', 'Davis Riley', 'Ethan Fang'] },
  { time: '12:03 PM', names: ['Adam Scott', 'Daniel Berger', 'Brian Harman'] },
  { time: '12:15 PM', names: ['Fred Couples', 'Min Woo Lee', 'Pongsapak Laopakdee'] },
  { time: '12:27 PM', names: ['Sergio Garcia', 'Aaron Rai', 'Jacob Bridgeman'] },
  { time: '12:44 PM', names: ['Harry Hall', 'Corey Conners', 'Michael Brennan'] },
  { time: '12:56 PM', names: ['J.J. Spaun', 'Maverick McNealy', 'Tyrrell Hatton'] },
  { time: '1:08 PM', names: ['Jon Rahm', 'Chris Gotterup', 'Ludvig Aberg'] },
  { time: '1:20 PM', names: ['Jordan Spieth', 'Justin Rose', 'Brooks Koepka'] },
  { time: '1:32 PM', names: ['Sepp Straka', 'Ben Griffin', 'Justin Thomas'] },
  { time: '1:44 PM', names: ['Scottie Scheffler', 'Robert MacIntyre', 'Gary Woodland'] },
  { time: '1:56 PM', names: ['Harris English', 'Marco Penge', 'Si Woo Kim'] },
];

/**
 * Parse a tee time string like "7:40 AM" or "1:08 PM" → minutes since midnight.
 * Returns 9999 if the string doesn't match a tee-time pattern (e.g. "--", "F", "7").
 */
export function parseTeeTimeMinutes(teeTime: string): number {
  const match = teeTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return 9999;
  let hour = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return hour * 60 + min;
}
