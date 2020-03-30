pragma solidity ^0.5.0;

library SafeStringCast {
    function toUint(string memory self) pure internal returns(uint16){
        uint16 stringToUintCast = 0;
        bytes memory byteString = bytes(self);
        for(uint i = 0; i < byteString.length; i++){
            uint8 byteToUintCast = uint8(byteString[i]);
            if(byteToUintCast >= 48 && byteToUintCast <= 57){
                stringToUintCast = stringToUintCast * 10 + (byteToUintCast - 48);
            }
        }

        return stringToUintCast;
    }
}
