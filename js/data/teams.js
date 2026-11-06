/* ==========================================================================
 * NQ.data — franchise directory + fictional name pools.
 *
 * Franchise names/abbreviations are used as labels only. Every player name,
 * rating and statistic in the terminal is synthetic. No logos are used.
 * ========================================================================== */
(function (NQ) {
  'use strict';

  // [abbr, city, nickname, conference, division, primary, secondary, team latent tilt]
  // Tilt = [offense, defense, pp, pk, goalie] in latent SD units (shapes the synthetic league).
  const TEAMS = [
    ['BOS', 'Boston', 'Bruins', 'East', 'Atlantic', '#FFB81C', '#111111', [0.10, 0.22, 0.05, 0.15, 0.25]],
    ['BUF', 'Buffalo', 'Sabres', 'East', 'Atlantic', '#2F6BD1', '#FCB514', [0.00, -0.12, 0.00, -0.10, -0.15]],
    ['DET', 'Detroit', 'Red Wings', 'East', 'Atlantic', '#CE1126', '#FFFFFF', [0.05, -0.05, 0.12, -0.05, 0.00]],
    ['FLA', 'Florida', 'Panthers', 'East', 'Atlantic', '#C8102E', '#B9975B', [0.18, 0.18, 0.05, 0.10, 0.10]],
    ['MTL', 'Montreal', 'Canadiens', 'East', 'Atlantic', '#AF1E2D', '#192168', [0.02, -0.08, 0.05, -0.05, 0.05]],
    ['OTT', 'Ottawa', 'Senators', 'East', 'Atlantic', '#C52032', '#C2912C', [0.08, 0.02, -0.05, 0.05, 0.00]],
    ['TBL', 'Tampa Bay', 'Lightning', 'East', 'Atlantic', '#2F6BD1', '#FFFFFF', [0.15, 0.05, 0.20, 0.00, 0.15]],
    ['TOR', 'Toronto', 'Maple Leafs', 'East', 'Atlantic', '#3D7CE0', '#FFFFFF', [0.22, 0.12, 0.18, 0.05, 0.12]],
    ['CAR', 'Carolina', 'Hurricanes', 'East', 'Metropolitan', '#CE1126', '#A2AAAD', [0.12, 0.25, -0.02, 0.20, 0.00]],
    ['CBJ', 'Columbus', 'Blue Jackets', 'East', 'Metropolitan', '#3A6FC4', '#CE1126', [0.00, -0.10, -0.05, -0.08, -0.05]],
    ['NJD', 'New Jersey', 'Devils', 'East', 'Metropolitan', '#CE1126', '#FFFFFF', [0.12, 0.08, 0.05, 0.05, -0.05]],
    ['NYI', 'New York', 'Islanders', 'East', 'Metropolitan', '#F47D30', '#3A6FC4', [-0.10, 0.05, -0.10, 0.05, 0.15]],
    ['NYR', 'New York', 'Rangers', 'East', 'Metropolitan', '#2F6BD1', '#CE1126', [0.05, -0.02, 0.10, 0.00, 0.20]],
    ['PHI', 'Philadelphia', 'Flyers', 'East', 'Metropolitan', '#F74902', '#FFFFFF', [-0.02, 0.00, -0.12, 0.05, -0.12]],
    ['PIT', 'Pittsburgh', 'Penguins', 'East', 'Metropolitan', '#FCB514', '#111111', [0.02, -0.15, 0.08, -0.10, -0.10]],
    ['WSH', 'Washington', 'Capitals', 'East', 'Metropolitan', '#C8102E', '#3A6FC4', [0.10, 0.05, 0.08, 0.08, 0.05]],
    ['CHI', 'Chicago', 'Blackhawks', 'West', 'Central', '#CF0A2C', '#FFFFFF', [-0.15, -0.20, -0.05, -0.12, -0.10]],
    ['COL', 'Colorado', 'Avalanche', 'West', 'Central', '#A6192E', '#3A6FC4', [0.25, 0.05, 0.20, 0.00, -0.05]],
    ['DAL', 'Dallas', 'Stars', 'West', 'Central', '#00A36C', '#8F8F8C', [0.12, 0.15, 0.05, 0.10, 0.12]],
    ['MIN', 'Minnesota', 'Wild', 'West', 'Central', '#2E8B57', '#A6192E', [0.02, 0.08, 0.00, 0.05, 0.05]],
    ['NSH', 'Nashville', 'Predators', 'West', 'Central', '#FFB81C', '#3A6FC4', [-0.08, -0.05, -0.08, 0.00, 0.10]],
    ['STL', 'St. Louis', 'Blues', 'West', 'Central', '#2F6BD1', '#FCB514', [-0.02, -0.02, 0.00, -0.05, 0.00]],
    ['UTA', 'Utah', 'Mammoth', 'West', 'Central', '#6CACE4', '#111111', [0.05, 0.05, -0.05, 0.02, 0.00]],
    ['WPG', 'Winnipeg', 'Jets', 'West', 'Central', '#3A6FC4', '#AC162C', [0.10, 0.10, 0.12, 0.05, 0.30]],
    ['ANA', 'Anaheim', 'Ducks', 'West', 'Pacific', '#F47A38', '#B9975B', [-0.08, -0.12, -0.10, -0.08, 0.00]],
    ['CGY', 'Calgary', 'Flames', 'West', 'Pacific', '#C8102E', '#F1BE48', [-0.05, 0.05, -0.05, 0.05, 0.05]],
    ['EDM', 'Edmonton', 'Oilers', 'West', 'Pacific', '#FF4C00', '#3A6FC4', [0.22, 0.00, 0.28, -0.02, -0.08]],
    ['LAK', 'Los Angeles', 'Kings', 'West', 'Pacific', '#A2AAAD', '#111111', [0.02, 0.20, -0.05, 0.15, 0.00]],
    ['SEA', 'Seattle', 'Kraken', 'West', 'Pacific', '#68A2B9', '#99D9D9', [-0.05, 0.00, -0.08, 0.00, -0.05]],
    ['SJS', 'San Jose', 'Sharks', 'West', 'Pacific', '#00A3AD', '#EA7200', [-0.18, -0.22, -0.10, -0.15, -0.15]],
    ['VAN', 'Vancouver', 'Canucks', 'West', 'Pacific', '#3A6FC4', '#00843D', [0.05, 0.00, 0.05, -0.02, 0.10]],
    ['VGK', 'Vegas', 'Golden Knights', 'West', 'Pacific', '#B4975A', '#C8102E', [0.12, 0.12, 0.05, 0.10, 0.05]]
  ];

  const FIRST = ['Aaron', 'Adam', 'Aleksi', 'Anton', 'Arvid', 'Austin', 'Axel', 'Ben', 'Blake', 'Brady', 'Brendan', 'Caleb', 'Callum', 'Carter', 'Casey', 'Cole', 'Connor', 'Dante', 'Darius', 'Declan', 'Dmitri', 'Dylan', 'Eero', 'Elias', 'Emil', 'Erik', 'Ethan', 'Evan', 'Felix', 'Filip', 'Finn', 'Gabriel', 'Gavin', 'Grant', 'Gus', 'Hampus', 'Henrik', 'Hudson', 'Ivan', 'Jace', 'Jack', 'Jakob', 'Jalen', 'Jonas', 'Jordan', 'Kaapo', 'Kasper', 'Kieran', 'Kirill', 'Kyle', 'Lars', 'Leo', 'Liam', 'Logan', 'Lucas', 'Luka', 'Marek', 'Matias', 'Max', 'Mikael', 'Milan', 'Nate', 'Niko', 'Nolan', 'Oliver', 'Oskar', 'Owen', 'Patrik', 'Quinn', 'Reid', 'Riley', 'Roman', 'Ryan', 'Sami', 'Sean', 'Simon', 'Stefan', 'Teodor', 'Theo', 'Tomas', 'Tyler', 'Valtteri', 'Viktor', 'Wes', 'Wyatt', 'Yegor', 'Zach'];

  const LAST = ['Aalto', 'Abbott', 'Achterberg', 'Ahlqvist', 'Barrow', 'Beaulieu', 'Becker', 'Bergstrom', 'Blom', 'Bouchard', 'Brandt', 'Brennan', 'Calder', 'Carrick', 'Castellan', 'Cerny', 'Charbonneau', 'Cormier', 'Dahlgren', 'Danforth', 'Decker', 'Desrosiers', 'Dvorak', 'Eklund', 'Engstrom', 'Falk', 'Faulkner', 'Fenwick', 'Forsberg', 'Fournier', 'Gagne', 'Garland', 'Granlund', 'Grayson', 'Gustafsson', 'Haas', 'Hagen', 'Halloran', 'Hartley', 'Hedman', 'Holmberg', 'Horak', 'Hutchins', 'Iversen', 'Jarvi', 'Jensen', 'Juneau', 'Kaskinen', 'Keane', 'Kellner', 'Kivisto', 'Koivu', 'Kowalski', 'Krejci', 'Laine', 'Lambert', 'Landry', 'Lehtonen', 'Lemieux', 'Lindqvist', 'Lund', 'MacKinnon', 'Maki', 'Malkov', 'Marchand', 'Markov', 'McCall', 'McGregor', 'Moberg', 'Morrow', 'Nagy', 'Nieminen', 'Novak', 'Nyberg', 'Olsen', 'Orlov', 'Ouellet', 'Paquette', 'Pelletier', 'Pesce', 'Pickard', 'Plante', 'Quist', 'Radulov', 'Rask', 'Reinholt', 'Rinne', 'Rousseau', 'Ruutu', 'Saarinen', 'Sandberg', 'Savard', 'Schenk', 'Sedin', 'Selanne', 'Sharpe', 'Simek', 'Sorensen', 'Stahl', 'Stenlund', 'Strand', 'Sullivan', 'Sundqvist', 'Tamer', 'Theriault', 'Thornton', 'Toivonen', 'Tremblay', 'Turcotte', 'Ullmark', 'Vachon', 'Valk', 'Vasko', 'Vesey', 'Virtanen', 'Volkov', 'Wahlberg', 'Walsh', 'Wennberg', 'Whitlock', 'Wick', 'Wolski', 'Yandle', 'Zadina', 'Zaitsev', 'Zellweger', 'Zubov', 'Ashby', 'Bramwell', 'Corrigan', 'Dorsey', 'Ellery', 'Fairbanks', 'Gaudet', 'Hollis', 'Ingram', 'Kearns', 'Larkin', 'Mattson', 'Northcott', 'Prentice', 'Quarry', 'Rowan', 'Stroud', 'Talbot', 'Underwood', 'Vance', 'Winslow'];

  // The featured franchise mirrors the mock-up's fictional roster names.
  // Lines are C – LW – RW; pairs are D1 – D2; goalies are starter, backup.
  const FEATURED = {
    TOR: {
      lines: [[['Alex', 'Rivera', 34], ['Mason', 'Holt', 16], ['Jae', 'Park', 88]],
        [['Nils', 'Madsen', 19], ['Tyler', 'Cole', 23], ['Daniel', 'Varga', 11]],
        [['Owen', 'Neill', 21], ['Ilya', 'Petrov', 47], ['Jordan', 'King', 28]],
        [['Cody', 'Boone', 52], ['Brody', 'Ellis', 64], ['Sam', 'Frye', 39]]],
      pairs: [[['Erik', 'Lang', 44], ['Shane', "O'Brien", 3]], [['Aku', 'Salo', 8], ['Ryan', 'Bennett', 55]], [['Cal', 'Mercer', 2], ['Luke', 'Dale', 25]]],
      goalies: [['Marcus', 'Lindgren', 31], ['Pavel', 'Holub', 35]]
    }
  };

  NQ.data = { TEAMS, FIRST, LAST, FEATURED };
})(globalThis.NQ = globalThis.NQ || {});
