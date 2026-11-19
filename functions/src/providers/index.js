import tuya from './tuya.js';
import volvo from './volvo.js';
import google from './google.js';
import homeassistant from './homeassistant.js';
import wallbox from './wallbox.js';
import smartthings from './smartthings.js';
import imou from './imou.js';
import solis from './solis.js';
import motion from './motion.js';
import huawei from './huawei.js';
import solaredge from './solaredge.js';
import enphase from './enphase.js';
import growatt from './growatt.js';

/** Add a new integration by writing a module with the same shape and registering it here. */
export const providers = { tuya, volvo, google, homeassistant, wallbox, smartthings, imou, solis, motion, huawei, solaredge, enphase, growatt };
