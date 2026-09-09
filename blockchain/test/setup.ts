import { use } from "chai";
import chaiAsPromised from "chai-as-promised";

// Registers `.rejectedWith`, which every invalid-transition assertion needs.
// Loaded via .mocharc.json so it runs before any test file.
use(chaiAsPromised);
