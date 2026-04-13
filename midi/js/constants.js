// ─────────────────────────────────────────────────────────────────────────────
// SHARED CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const NOTE_TOP = 83; // B5
const NOTE_BOT = 36; // C2
const NOTES = [];
for (let n = NOTE_TOP; n >= NOTE_BOT; n--) NOTES.push(n);

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const isBlack    = midi => [1,3,6,8,10].includes(midi % 12);
const noteName   = midi => NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);

// GM drum map labels for channel 9 notes (abbreviated + full)
const GM_DRUM = {
  35: ['BD2',  'Bass Drum 2'],    36: ['BD',   'Bass Drum'],
  37: ['Rim',  'Side Stick'],     38: ['SN',   'Snare'],
  39: ['Clap', 'Hand Clap'],      40: ['ESN',  'Elec Snare'],
  41: ['LFT',  'Low Floor Tom'],  42: ['CHH',  'Closed HiHat'],
  43: ['HFT',  'Hi Floor Tom'],   44: ['PHH',  'Pedal HiHat'],
  45: ['LT',   'Low Tom'],        46: ['OHH',  'Open HiHat'],
  47: ['LMT',  'Lo-Mid Tom'],     48: ['HMT',  'Hi-Mid Tom'],
  49: ['CRS',  'Crash 1'],        50: ['HT',   'High Tom'],
  51: ['RDE',  'Ride 1'],         52: ['CHN',  'Chinese Cym'],
  53: ['RBL',  'Ride Bell'],      54: ['TBR',  'Tambourine'],
  55: ['SPL',  'Splash'],         56: ['CBL',  'Cowbell'],
  57: ['CRS2', 'Crash 2'],        58: ['VSP',  'Vibraslap'],
  59: ['RD2',  'Ride 2'],         60: ['HBG',  'Hi Bongo'],
  61: ['LBG',  'Lo Bongo'],       62: ['MCG',  'Mute Conga'],
  63: ['HCG',  'Hi Conga'],       64: ['LCG',  'Lo Conga'],
  65: ['HTB',  'Hi Timbale'],     66: ['LTB',  'Lo Timbale'],
  67: ['HAG',  'Hi Agogo'],       68: ['LAG',  'Lo Agogo'],
  69: ['CBS',  'Cabasa'],         70: ['MRC',  'Maracas'],
  71: ['SWH',  'Short Whistle'],  72: ['LWH',  'Long Whistle'],
  73: ['SGR',  'Short Guiro'],    74: ['LGR',  'Long Guiro'],
  75: ['CLV',  'Claves'],         76: ['HWB',  'Hi WoodBlock'],
  77: ['LWB',  'Lo WoodBlock'],   78: ['MCU',  'Mute Cuica'],
  79: ['OCU',  'Open Cuica'],     80: ['MTR',  'Mute Triangle'],
  81: ['OTR',  'Open Triangle'],  82: ['SHK',  'Shaker'],
  83: ['JBL',  'Jingle Bell'],
};

const LAYER_COLORS = ['#c8a84b','#4b8bc8','#5ca87a','#c8604b','#a04bc8','#c8b04b'];

const INST_DATA = {
  pokemon: {
    label: 'Pokemon',
    banks: {
      0: [
        [0,'Bright Piano'],[4,'Electric Piano'],[8,'Celesta'],[9,'Glockenspiel'],
        [10,'Music Box'],[12,'Marimba'],[14,'Tubular Bell'],[19,'Pipe Organ'],
        [24,'Nylon Guitar'],[29,'Overdrive Guitar'],[30,'Distortion Guitar'],
        [33,'Electric Bass'],[35,'Fretless Bass'],[36,'Slap Bass'],[38,'Synth Bass'],
        [46,'Harp'],[47,'Timpani'],[48,'Strings'],[52,'Voice Aahs'],
        [55,'Orchestra Hit'],[56,'Trumpet'],[60,'French Horn'],[68,'Oboe'],
        [73,'Flute'],[79,'Ocarina'],[80,'GB Square'],[81,'GB Sawtooth'],
        [82,'GB Calliope'],[84,'GB Charang'],[85,'GB Voice'],[87,'GB Bass+Lead'],
        [89,'Pad 2'],[107,'Koto'],[114,'Steel Drum'],[125,'8-Bit Bass'],
      ],
      1: [
        [80,'GB Square 2'],[81,'GB Square 3'],[82,'GB Calliope 2'],
      ],
      128: [
        [0,'Standard Kit'],[8,'Room Kit'],[16,'Power Kit'],
        [24,'Electronic Kit'],[25,'TR-808'],[32,'Jazz Kit'],[40,'Brush Kit'],
      ],
    }
  },
  msgs: {
    label: 'MSGS',
    banks: {
      0: [
        [0,'Piano 1'],[1,'Piano 2'],[2,'Piano 3'],[3,'Honky-tonk'],
        [4,'E.Piano 1'],[5,'E.Piano 2'],[6,'Harpsichord'],[7,'Clav.'],
        [8,'Celesta'],[9,'Glockenspiel'],[10,'Music Box'],[11,'Vibraphone'],
        [12,'Marimba'],[13,'Xylophone'],[14,'Tubular-bell'],[15,'Santur'],
        [16,'Organ 1'],[17,'Organ 2'],[18,'Organ 3'],[19,'Church Org.1'],
        [20,'Reed Organ'],[21,'Accordion Fr'],[22,'Harmonica'],[23,'Bandoneon'],
        [24,'Nylon-str.Gt'],[25,'Steel-str.Gt'],[26,'Jazz Gt.'],[27,'Clean Gt.'],
        [28,'Muted Gt.'],[29,'Overdrive Gt'],[30,'DistortionGt'],[31,'Gt.Harmonics'],
        [32,'Acoustic Bs.'],[33,'Fingered Bs.'],[34,'Picked Bs.'],[35,'Fretless Bs.'],
        [36,'Slap Bass 1'],[37,'Slap Bass 2'],[38,'Synth Bass 1'],[39,'Synth Bass 2'],
        [40,'Violin'],[41,'Viola'],[42,'Cello'],[43,'Contrabass'],
        [44,'Tremolo Str'],[45,'PizzicatoStr'],[46,'Harp'],[47,'Timpani'],
        [48,'Strings'],[49,'Slow Strings'],[50,'Syn.Strings1'],[51,'Syn.Strings2'],
        [52,'Choir Aahs'],[53,'Voice Oohs'],[54,'SynVox'],[55,'OrchestraHit'],
        [56,'Trumpet'],[57,'Trombone'],[58,'Tuba'],[59,'MutedTrumpet'],
        [60,'French Horns'],[61,'Brass 1'],[62,'Synth Brass1'],[63,'Synth Brass2'],
        [64,'Soprano Sax'],[65,'Alto Sax'],[66,'Tenor Sax'],[67,'Baritone Sax'],
        [68,'Oboe'],[69,'English Horn'],[70,'Bassoon'],[71,'Clarinet'],
        [72,'Piccolo'],[73,'Flute'],[74,'Recorder'],[75,'Pan Flute'],
        [76,'Bottle Blow'],[77,'Shakuhachi'],[78,'Whistle'],[79,'Ocarina'],
        [80,'Square Wave'],[81,'Saw Wave'],[82,'Syn.Calliope'],[83,'Chiffer Lead'],
        [84,'Charang'],[85,'Solo Vox'],[86,'5th Saw Wave'],[87,'Bass & Lead'],
        [88,'Fantasia'],[89,'Warm Pad'],[90,'Polysynth'],[91,'Space Voice'],
        [92,'Bowed Glass'],[93,'Metal Pad'],[94,'Halo Pad'],[95,'Sweep Pad'],
        [96,'Ice Rain'],[97,'Soundtrack'],[98,'Crystal'],[99,'Atmosphere'],
        [100,'Brightness'],[101,'Goblin'],[102,'Echo Drops'],[103,'Star Theme'],
        [104,'Sitar'],[105,'Banjo'],[106,'Shamisen'],[107,'Koto'],
        [108,'Kalimba'],[109,'Bagpipe'],[110,'Fiddle'],[111,'Shanai'],
        [112,'Tinkle Bell'],[113,'Agogo'],[114,'Steel Drums'],[115,'Woodblock'],
        [116,'Taiko'],[117,'Melo. Tom 1'],[118,'Synth Drum'],[119,'Reverse Cym.'],
        [120,'Gt.FretNoise'],[121,'Breath Noise'],[122,'Seashore'],[123,'Bird'],
        [124,'Telephone 1'],[125,'Helicopter'],[126,'Applause'],[127,'Gun Shot'],
      ],
      128: [
        [0,'Standard'],[8,'Room'],[16,'Power'],[24,'Electronic'],
        [25,'TR-808'],[32,'Jazz'],[40,'Brush'],[48,'Orchestra'],[56,'SFX'],
      ],
    }
  },
  megadrive: {
    label: 'Megadrive',
    banks: {
      0: [
        [0,'Piano'],[4,'E.Piano'],[6,'Harpsichord'],[7,'Clavinet'],
        [8,'Chimes'],[16,'Organ 1'],[18,'Organ 3'],[24,'Nylon Guitar'],
        [25,'Steel Guitar'],[27,'Clean Guitar'],[29,'Dist.Guitar'],[31,'Mute Guitar'],
        [32,'Acoustic Bass'],[36,'Slap Bass'],[38,'Synth Bass'],[45,'Pizz.Strings'],
        [46,'Harp'],[48,'Strings'],[52,'Choir'],[55,'Orchestra Hit'],
        [56,'Trumpet'],[57,'Trombone'],[61,'Brass'],[68,'Clarinet'],
        [69,'Oboe'],[72,'Flute'],[78,'Whistle'],[80,'Square Wave'],
        [81,'Sawtooth'],[82,'Lead 1'],[83,'Lead 2'],[89,'Warm Pad'],
        [90,'Sweep Pad'],[91,'Choir Pad'],
      ],
      128: [
        [0,'MD Drums'],[25,'MD TR-808'],[32,'MD Jazz Kit'],
      ],
    }
  },
};

const INST_NAMES = {
  pokemon: {
    '0,0':'Bright Piano','0,4':'Electric Piano','0,8':'Celesta','0,9':'Glockenspiel',
    '0,10':'Music Box','0,12':'Marimba','0,14':'Tubular Bell','0,19':'Pipe Organ',
    '0,24':'Nylon Guitar','0,29':'Overdrive Guitar','0,30':'Distortion Gtr',
    '0,33':'Electric Bass','0,35':'Fretless Bass','0,36':'Slap Bass','0,38':'Synth Bass',
    '0,46':'Harp','0,47':'Timpani','0,48':'Strings','0,52':'Voice Aahs',
    '0,55':'Orchestra Hit','0,56':'Trumpet','0,60':'French Horn','0,68':'Oboe',
    '0,73':'Flute','0,79':'Ocarina','0,80':'GB Square','0,81':'GB Sawtooth',
    '0,82':'GB Calliope','0,84':'GB Charang','0,85':'GB Voice','0,87':'GB Bass+Lead',
    '0,89':'Pad 2','0,107':'Koto','0,114':'Steel Drum','0,125':'8-Bit Bass',
    '1,80':'GB Square 2','1,81':'GB Square 3','1,82':'GB Calliope 2',
  },
  megadrive: {
    '0,0':'Piano','0,4':'E. Piano','0,6':'Harpsichord','0,7':'Clavinet',
    '0,8':'Chimes','0,16':'Organ 1','0,18':'Organ 3','0,24':'Nylon Guitar',
    '0,25':'Steel Guitar','0,27':'Clean Guitar','0,29':'Dist. Guitar','0,31':'Mute Guitar',
    '0,32':'Acoustic Bass','0,36':'Slap Bass','0,38':'Synth Bass','0,45':'Pizz. Strings',
    '0,46':'Harp','0,48':'Strings','0,52':'Choir','0,55':'Orchestra Hit',
    '0,56':'Trumpet','0,57':'Trombone','0,61':'Brass','0,68':'Clarinet',
    '0,69':'Oboe','0,72':'Flute','0,78':'Whistle','0,80':'Square Wave',
    '0,81':'Sawtooth','0,82':'Lead 1','0,83':'Lead 2','0,89':'Warm Pad',
    '0,90':'Sweep Pad','0,91':'Choir Pad',
  },
  msgs: {
    '0,0':'Piano 1','0,1':'Piano 2','0,2':'Piano 3','0,3':'Honky-tonk',
    '0,4':'E.Piano 1','0,5':'E.Piano 2','0,6':'Harpsichord','0,7':'Clav.',
    '0,8':'Celesta','0,9':'Glockenspiel','0,10':'Music Box','0,11':'Vibraphone',
    '0,12':'Marimba','0,13':'Xylophone','0,14':'Tubular-bell','0,15':'Santur',
    '0,16':'Organ 1','0,17':'Organ 2','0,18':'Organ 3','0,19':'Church Org.1',
    '0,20':'Reed Organ','0,21':'Accordion','0,22':'Harmonica','0,23':'Bandoneon',
    '0,24':'Nylon-str.Gt','0,25':'Steel-str.Gt','0,26':'Jazz Gt.','0,27':'Clean Gt.',
    '0,28':'Muted Gt.','0,29':'Overdrive Gt','0,30':'DistortionGt','0,31':'Gt.Harmonics',
    '0,32':'Acoustic Bs.','0,33':'Fingered Bs.','0,34':'Picked Bs.','0,35':'Fretless Bs.',
    '0,36':'Slap Bass 1','0,37':'Slap Bass 2','0,38':'Synth Bass 1','0,39':'Synth Bass 2',
    '0,40':'Violin','0,41':'Viola','0,42':'Cello','0,43':'Contrabass',
    '0,44':'Tremolo Str','0,45':'PizzicatoStr','0,46':'Harp','0,47':'Timpani',
    '0,48':'Strings','0,49':'Slow Strings','0,50':'Syn.Strings1','0,51':'Syn.Strings2',
    '0,52':'Choir Aahs','0,53':'Voice Oohs','0,54':'SynVox','0,55':'OrchestraHit',
    '0,56':'Trumpet','0,57':'Trombone','0,58':'Tuba','0,59':'MutedTrumpet',
    '0,60':'French Horns','0,61':'Brass 1','0,62':'Synth Brass1','0,63':'Synth Brass2',
    '0,64':'Soprano Sax','0,65':'Alto Sax','0,66':'Tenor Sax','0,67':'Baritone Sax',
    '0,68':'Oboe','0,69':'English Horn','0,70':'Bassoon','0,71':'Clarinet',
    '0,72':'Piccolo','0,73':'Flute','0,74':'Recorder','0,75':'Pan Flute',
    '0,76':'Bottle Blow','0,77':'Shakuhachi','0,78':'Whistle','0,79':'Ocarina',
    '0,80':'Square Wave','0,81':'Saw Wave','0,82':'Syn.Calliope','0,83':'Chiffer Lead',
    '0,84':'Charang','0,85':'Solo Vox','0,86':'5th Saw Wave','0,87':'Bass & Lead',
    '0,88':'Fantasia','0,89':'Warm Pad','0,90':'Polysynth','0,91':'Space Voice',
    '0,92':'Bowed Glass','0,93':'Metal Pad','0,94':'Halo Pad','0,95':'Sweep Pad',
    '0,96':'Ice Rain','0,97':'Soundtrack','0,98':'Crystal','0,99':'Atmosphere',
    '0,100':'Brightness','0,101':'Goblin','0,102':'Echo Drops','0,103':'Star Theme',
    '0,104':'Sitar','0,105':'Banjo','0,106':'Shamisen','0,107':'Koto',
    '0,108':'Kalimba','0,109':'Bagpipe','0,110':'Fiddle','0,111':'Shanai',
    '0,112':'Tinkle Bell','0,113':'Agogo','0,114':'Steel Drums','0,115':'Woodblock',
    '0,116':'Taiko','0,117':'Melo. Tom 1','0,118':'Synth Drum','0,119':'Reverse Cym.',
  }
};

function resolveInstrumentName(sf, program, bank = 0) {
  const tbl = INST_NAMES[sf];
  if (!tbl) return `prog ${program}`;
  return tbl[`${bank},${program}`] || `prog ${program}`;
}
