/** Public configuration. Private provider credentials exist only in server env. */
export const API_CONFIG = {
  theOddsApi: {baseUrl:'/api/odds',regions:'ca',markets:'h2h'},
  oddsBlaze: {enabled:false,baseUrl:'/api/oddsblaze',leagues:[],sportsbooks:[],sleepMsBetweenCalls:2100},
  sportsDb: {key:'123',baseUrl:'https://www.thesportsdb.com/api/v1/json/123',sleepMsBetweenCalls:2100},
};
export const QUOTA = {monthlyLimit:500,warnThreshold:80,stopThreshold:15,costForSportsList:0};
export const POLL_CONFIG = {manualOnly:true,defaultIntervalMs:259200000,minIntervalMs:259200000,maxSports:1};
export const PRIORITY_SPORTS = ['soccer_epl','soccer_spain_la_liga','soccer_italy_serie_a','soccer_germany_bundesliga','soccer_france_ligue_one','soccer_uefa_champs_league','soccer_uefa_europa_league','americanfootball_nfl','americanfootball_ncaaf','basketball_nba'];
