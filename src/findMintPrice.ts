import { ethers } from "ethers";
import { formatEther, Contract, JsonRpcProvider, Provider } from "ethers";

// SeaDrop ABI (최소한의 필요한 부분만 포함)
const seaDropABI = [
  "function getPublicDrop(address nftContract) external view returns (tuple(uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 maxTokenSupplyForStage, address feeBps))"
];

/**
 * SeaDrop 컨트랙트에서 NFT의 퍼블릭 민팅 정보를 조회합니다
 * @param provider 이더리움 프로바이더
 * @param seaDropAddress SeaDrop 컨트랙트 주소
 * @param nftContractAddress NFT 컨트랙트 주소
 * @returns 민팅 가격, 시작/종료 시간 등의 정보
 */
async function getPublicDropInfo(
  provider: Provider,
  seaDropAddress: string,
  nftContractAddress: string
) {
  try {
    // SeaDrop 컨트랙트 인스턴스 생성
    const seaDropContract = new Contract(
      seaDropAddress,
      seaDropABI,
      provider
    );
    
    // 퍼블릭 드롭 정보 조회
    const publicDrop = await seaDropContract.getPublicDrop(nftContractAddress);
    
    // 결과 포맷팅
    const result = {
      mintPrice: formatEther(publicDrop.mintPrice),  // ETH 단위로 변환
      startTime: new Date(Number(publicDrop.startTime) * 1000),   // 타임스탬프를 Date 객체로 변환
      endTime: new Date(Number(publicDrop.endTime) * 1000),
      maxTotalMintableByWallet: Number(publicDrop.maxTotalMintableByWallet),
      maxTokenSupplyForStage: Number(publicDrop.maxTokenSupplyForStage),
      feeBps: publicDrop.feeBps
    };
    
    return result;
  } catch (error) {
    console.error("퍼블릭 드롭 정보 조회 실패:", error);
    throw error;
  }
}

// 사용 예시
async function main() {
  // Base 네트워크에 연결 (basescan.org에 있는 컨트랙트이므로)
  const provider = new JsonRpcProvider("https://mainnet.base.org");
  
  // SeaDrop 컨트랙트 주소 (주소는 예시이므로 실제 주소로 교체해야 합니다)
  const seaDropAddress = "0x00005ea00ac477b1030ce78506496e8c2de24bf5"; // 예시 주소
  
  // NFT 컨트랙트 주소 (basescan.org에서 보고 있던 컨트랙트)
  const nftContractAddress = "0xb2049d0bd421808c77cf64d5c8b2ae3cb34c61fd";
  
  const dropInfo = await getPublicDropInfo(provider, seaDropAddress, nftContractAddress);
  console.log("퍼블릭 드롭 정보:", dropInfo);
  console.log(`민팅 가격: ${dropInfo.mintPrice} ETH`);
  console.log(`판매 기간: ${dropInfo.startTime} ~ ${dropInfo.endTime}`);
}

main().catch(console.error);